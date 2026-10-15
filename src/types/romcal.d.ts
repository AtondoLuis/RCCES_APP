declare module "romcal" {
  type TemporalDay = {
    moment: { format(pattern: string): string };
    name: string;
  };
  export const Seasons: {
    laterOrdinaryTime(year: number): TemporalDay[];
    earlyOrdinaryTime(year: number, christmasEnd: string, epiphanyOnJan6: boolean): TemporalDay[];
    advent(year: number): TemporalDay[];
    lent(year: number): TemporalDay[];
    eastertide(year: number): TemporalDay[];
    christmastide(year: number, christmasEnd: string, epiphanyOnJan6: boolean): TemporalDay[];
  };
}
