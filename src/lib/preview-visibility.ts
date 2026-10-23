export type PreviewVisibility = {
  hidden_categories: string[];
  hidden_services: string[];
};

export const visibleByDefault: PreviewVisibility = { hidden_categories: [], hidden_services: [] };

export function previewVisibility(value?: PreviewVisibility | null): PreviewVisibility {
  return value ?? visibleByDefault;
}

export function isCategoryVisible(value: PreviewVisibility | null | undefined, id: string): boolean {
  return !previewVisibility(value).hidden_categories.includes(id);
}

export function isServiceVisible(value: PreviewVisibility | null | undefined, id: string): boolean {
  return !previewVisibility(value).hidden_services.includes(id);
}

export function togglePreviewVisibility(
  value: PreviewVisibility | null | undefined,
  kind: "category" | "service",
  id: string,
): PreviewVisibility {
  const current = previewVisibility(value);
  const key = kind === "category" ? "hidden_categories" : "hidden_services";
  const hidden = current[key];
  return {
    ...current,
    [key]: hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id],
  };
}
