/** Deep-link into the content list detail modal. */
export type ContentDetailTab = "overview" | "info" | "episodes" | "policy";

export function contentDetailHref(id: string, tab?: ContentDetailTab) {
  const qs = new URLSearchParams({ modal: "detail", id });
  if (tab) qs.set("tab", tab);
  return `/content?${qs.toString()}`;
}

export function parseContentDetailTab(raw: string | null | undefined): ContentDetailTab | null {
  if (raw === "overview" || raw === "info" || raw === "episodes" || raw === "policy") return raw;
  return null;
}
