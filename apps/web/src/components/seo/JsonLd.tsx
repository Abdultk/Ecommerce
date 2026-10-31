import { serializeJsonLd } from "@/lib/json-ld";

type Props = { data: unknown; nonce?: string };

/**
 * A JSON-LD data block. The serializer escapes <, >, & and line separators so content
 * (product names, descriptions) can never close the element; the nonce satisfies the CSP.
 */
export function JsonLd({ data, nonce }: Props) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Browsers hide a script's nonce attribute from the DOM, so the client always differs.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
