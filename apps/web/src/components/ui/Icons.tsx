import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Icon({ title, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const BagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" />
    <path d="M9 10V6.5a3 3 0 0 1 6 0V10" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const FlameIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21c3.9 0 6.5-2.6 6.5-6.2 0-3.4-2.5-5.6-4-8.8-.6 2-1.6 3.2-3 3.8.2-2.7-.8-5-3-6.8.3 3.3-4 5.7-4 10.1C4.5 17.9 7.6 21 12 21Z" />
  </Icon>
);

export const CoilIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </Icon>
);

export const DropIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 12h12" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 6v12M6 12h12" />
  </Icon>
);

export const FilterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);

/** Points the way text reads, so it turns around in right-to-left languages (see .flip-rtl). */
export const ArrowIcon = ({ className, ...p }: IconProps) => (
  <Icon {...p} className={className ? `flip-rtl ${className}` : "flip-rtl"}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const HeartIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}>
    <path
      fill={filled ? "currentColor" : "none"}
      d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"
    />
  </Icon>
);

/** The brand mark: a skillet seen from above, handle to the right. */
export const SkilletMark = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <circle cx="9.5" cy="12" r="6.5" />
    <circle cx="9.5" cy="12" r="3.6" strokeOpacity={0.55} />
    <path d="M16 12h6.2" strokeWidth={2.6} />
  </Icon>
);
