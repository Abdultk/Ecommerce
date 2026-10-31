"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { AdminCategoryInput } from "@hp/contracts";
import { Can } from "@/components/Can";
import { slugify } from "@/components/products/product-form-model";
import { Modal } from "@/components/ui/Modal";
import { TypedConfirmDialog } from "@/components/ui/TypedConfirmDialog";
import {
  CATEGORIES_KEY,
  indentLabel,
  subtreeIds,
  useCategories,
  type FlatCategory,
} from "@/lib/categories";
import { errorMessage, useSession } from "@/lib/session";

type Dialog =
  | { kind: "rename"; category: FlatCategory }
  | { kind: "move"; category: FlatCategory }
  | { kind: "delete"; category: FlatCategory };

const siblingCount = (flat: readonly FlatCategory[], parentId: string | null) =>
  flat.filter((c) => c.parentId === parentId).length;

/** Category tree with create, rename, move and delete (PATCH always sends the full input). */
export function CategoryManager() {
  const { api } = useSession();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const flat = categories.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY });

  async function save(category: FlatCategory, changes: Partial<AdminCategoryInput>) {
    const body = AdminCategoryInput.parse({
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      position: category.position,
      ...changes,
    });
    await api.patch(`/admin/categories/${category.id}`, body);
    await refresh();
    setDialog(null);
  }

  if (categories.isPending) {
    return (
      <p role="status" className="text-sm text-muted">
        Loading categories…
      </p>
    );
  }
  if (categories.isError) {
    return (
      <p role="alert" className="error-text">
        {errorMessage(categories.error)}
      </p>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="tree-title" className="panel p-4">
        <h2 id="tree-title" className="eyebrow mb-3 text-muted">
          Category tree
        </h2>
        <CategoryList nodes={flat} parentId={null} onAction={setDialog} />
      </section>
      <Can perm="product:write">
        <NewCategoryForm flat={flat} onCreated={refresh} />
      </Can>

      {dialog?.kind === "rename" && (
        <RenameDialog
          category={dialog.category}
          onSave={(c) => save(dialog.category, c)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "move" && (
        <MoveDialog
          category={dialog.category}
          flat={flat}
          onMove={(parentId) =>
            save(dialog.category, { parentId, position: siblingCount(flat, parentId) })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <TypedConfirmDialog
          title={`Delete ${dialog.category.name}?`}
          description="Only empty categories can be deleted: move its products and subcategories first."
          phrase={dialog.category.slug}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api.delete(`/admin/categories/${dialog.category.id}`);
            await refresh();
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

type CategoryListProps = {
  nodes: readonly FlatCategory[];
  parentId: string | null;
  onAction: (dialog: Dialog) => void;
};

function CategoryList({ nodes, parentId, onAction }: CategoryListProps) {
  const children = nodes.filter((c) => c.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <ul className={parentId ? "mt-1 ml-4 border-l border-line pl-3" : "space-y-1"}>
      {children.map((c) => (
        <li key={c.id} aria-labelledby={`cat-${c.id}`} className="py-0.5">
          <div className="group flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover:bg-paper">
            <span id={`cat-${c.id}`} className="font-medium text-ink-950">
              {c.name}
            </span>
            <span className="font-mono text-xs text-muted">{c.slug}</span>
            <Can perm="product:write">
              <span className="ml-auto flex gap-1">
                {(["rename", "move", "delete"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-quiet min-h-8 px-2 text-xs"
                    onClick={() => onAction({ kind, category: c })}
                  >
                    {kind[0]!.toUpperCase() + kind.slice(1)}
                    <span className="sr-only"> {c.name}</span>
                  </button>
                ))}
              </span>
            </Can>
          </div>
          <CategoryList nodes={nodes} parentId={c.id} onAction={onAction} />
        </li>
      ))}
    </ul>
  );
}

function NewCategoryForm({
  flat,
  onCreated,
}: {
  flat: readonly FlatCategory[];
  onCreated: () => Promise<unknown>;
}) {
  const { api } = useSession();
  const ids = useId();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parent = parentId || null;
    const parsed = AdminCategoryInput.safeParse({
      name,
      slug,
      parentId: parent,
      position: siblingCount(flat, parent),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post("/admin/categories", parsed.data);
      await onCreated();
      setName("");
      setSlug("");
      setSlugEdited(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-labelledby={`${ids}-title`}
      noValidate
      onSubmit={handleSubmit}
      className="panel space-y-3 p-4"
    >
      <h2 id={`${ids}-title`} className="font-display text-lg text-ink-950">
        New category
      </h2>
      <div>
        <label htmlFor={`${ids}-name`} className="field-label">
          Name
        </label>
        <input
          id={`${ids}-name`}
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
          className="field field-compact"
        />
      </div>
      <div>
        <label htmlFor={`${ids}-slug`} className="field-label">
          Slug
        </label>
        <input
          id={`${ids}-slug`}
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value);
          }}
          className="field field-compact font-mono"
        />
      </div>
      <div>
        <label htmlFor={`${ids}-parent`} className="field-label">
          Parent
        </label>
        <select
          id={`${ids}-parent`}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="field field-compact"
        >
          <option value="">None (top level)</option>
          {flat.map((c) => (
            <option key={c.id} value={c.id}>
              {indentLabel(c)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        Add category
      </button>
    </form>
  );
}

type RenameDialogProps = {
  category: FlatCategory;
  onSave: (changes: { name: string; slug: string }) => Promise<void>;
  onClose: () => void;
};

function RenameDialog({ category, onSave, onClose }: RenameDialogProps) {
  const ids = useId();
  const [name, setName] = useState(category.name);
  const [slug, setSlug] = useState(category.slug);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = AdminCategoryInput.pick({ name: true, slug: true }).safeParse({ name, slug });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    try {
      await onSave(parsed.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title="Rename category"
      description="Changing the slug changes the storefront URL."
      onClose={onClose}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor={`${ids}-name`} className="field-label">
            Name
          </label>
          <input
            id={`${ids}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor={`${ids}-slug`} className="field-label">
            Slug
          </label>
          <input
            id={`${ids}-slug`}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="field font-mono"
          />
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

type MoveDialogProps = {
  category: FlatCategory;
  flat: readonly FlatCategory[];
  onMove: (parentId: string | null) => Promise<void>;
  onClose: () => void;
};

function MoveDialog({ category, flat, onMove, onClose }: MoveDialogProps) {
  const ids = useId();
  const blocked = subtreeIds(flat, category.id);
  const [parentId, setParentId] = useState(category.parentId ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onMove(parentId || null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title={`Move ${category.name}`}
      description="It moves with all of its subcategories and goes last among its new siblings."
      onClose={onClose}
    >
      <form noValidate onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor={`${ids}-parent`} className="field-label">
            New parent
          </label>
          <select
            id={`${ids}-parent`}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="field"
          >
            <option value="">None (top level)</option>
            {flat
              .filter((c) => !blocked.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {indentLabel(c)}
                </option>
              ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Move
          </button>
        </div>
      </form>
    </Modal>
  );
}
