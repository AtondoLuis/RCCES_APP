import { load } from "cheerio";

import { Seasons } from "romcal";

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

const weekdays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function roman(number: number): string {
  let result = "";
  for (const [value, symbol] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const) {
    while (number >= value) { result += symbol; number -= value; }
  }
  return result;
}

export function baseLiturgicalDay(date: string): string | null {
  const year = Number(date.slice(0, 4));
  const weekday = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
  // Use the Proper of Time before sanctoral celebrations replace its ferias.
  const seasons = [
    () => Seasons.laterOrdinaryTime(year),
    () => Seasons.earlyOrdinaryTime(year, "o", false),
    () => Seasons.advent(year),
    () => Seasons.lent(year),
    () => Seasons.eastertide(year),
    () => Seasons.christmastide(year, "o", false),
    () => Seasons.christmastide(year - 1, "o", false),
  ];
  for (const season of seasons) {
    const day = season().find((entry) => entry.moment.format("YYYY-MM-DD") === date);
    if (!day) continue;
    const week = Number(day.name.match(/(\d+)(?:st|nd|rd|th) (?:week|Sunday)/i)?.[1]);
    const seasonName = /Ordinary Time$/.test(day.name) ? "del tiempo ordinario"
      : /Advent$/.test(day.name) ? "de Adviento"
      : /Lent$/.test(day.name) ? "de Cuaresma"
      : /Easter$/.test(day.name) ? "de Pascua" : null;
    if (week > 0 && seasonName) {
      return weekday === "Domingo" ? `${roman(week)} Domingo ${seasonName}`
        : `${weekday} de la ${roman(week)} semana ${seasonName}`;
    }
    const octave = day.name.match(/(\d+)(?:st|nd|rd|th) day in the Octave of Christmas/);
    if (octave) return `${roman(Number(octave[1]))} día de la Octava de Navidad`;
    if (/^Easter /.test(day.name)) return `${weekday} de la Octava de Pascua`;
    if (/Holy Week$/.test(day.name)) return `${weekday} de Semana Santa`;
    if (/after Ash Wednesday$/.test(day.name)) return `${weekday} después de Ceniza`;
    if (/before Epiphany$/.test(day.name)) return `${weekday} antes de la Epifanía`;
    if (/after Epiphany$/.test(day.name)) return `${weekday} después de la Epifanía`;
    if (/Christmastide$/.test(day.name)) return `${weekday} del tiempo de Navidad`;
    return null;
  }
  return null;
}

export function parseEwtnLiturgy(html: string, date: string): LiturgicalDay {
  const $ = load(html);
  const sourceUrl = `https://www.ewtn.com/es/lecturas/${date}`;
  if ($('link[rel="canonical"]').attr("href") !== sourceUrl) throw new Error("Liturgical date mismatch");
  const title = $('[data-component="daily-readings-page-title"]').first().text().replace(/\s+/g, " ").trim();
  if (!title || title.length > 300) throw new Error("Missing liturgical title");
  const name = title.replace(/^Octava de la Natividad:\s*/i, "");
  const isTemporal = /^(?:[IVXLCDM]+\s+)?Domingo\b/i.test(name)
    || /^(?:Lunes|Martes|Miércoles|Jueves|Viernes|Sábado)\b/i.test(name);
  const isSanctoral = /\((?:Memoria(?: Libre| Opcional)?|Fiesta|Solemnidad)\)/i.test(name)
    || /^(?:San(?:ta|to|tos|tas)?\b|Beato|Beata|Nuestra Señora|Solemnidad|Fiesta|Memoria|Inmaculada|Asunción)/i.test(name);
  const base = !isTemporal && isSanctoral ? baseLiturgicalDay(date) : null;
  return {
    celebration: base ?? title,
    subtitle: base && base !== name ? name : null,
    source: "EWTN",
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
