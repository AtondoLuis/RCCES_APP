import { load } from "cheerio";

export type LiturgicalDay = {
  celebration: string;
  subtitle: string | null;
  source: string;
  sourceUrl: string;
};

export function isLiturgicalDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number(date.slice(0, 4)) >= 1900
    && Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}

export function parseEwtnLiturgy(html: string, date: string): LiturgicalDay {
  const $ = load(html);
  const sourceUrl = `https://www.ewtn.com/es/lecturas/${date}`;
  if ($('link[rel="canonical"]').attr("href") !== sourceUrl) throw new Error("Liturgical date mismatch");
  const title = $('[data-component="daily-readings-page-title"]').first().text().replace(/\s+/g, " ").trim();
  // The octave is context, not a second celebration on January 1.
  const celebration = title.replace(/^Octava de la Natividad:\s*/i, "");
  if (!celebration || celebration.length > 300) throw new Error("Missing liturgical title");
  return {
    celebration,
    subtitle: null,
    source: "EWTN en español",
    sourceUrl,
  };
}

export async function getLiturgy(date: string): Promise<LiturgicalDay> {
  const response = await fetch(`https://www.ewtn.com/es/lecturas/${date}`, {
    headers: { Accept: "text/html" },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 86400 },
  });
  if (!response.ok) throw new Error("Liturgical source unavailable");
  return parseEwtnLiturgy(await response.text(), date);
}

