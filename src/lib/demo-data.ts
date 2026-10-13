export type Person = { id: string; name: string; services: string[]; active: boolean; phone?: string };
export type Service = { id: string; name: string; category: string; multiple?: boolean };
export type Assignment = Record<string, string[]>;

export const services: Service[] = [
  { id: "bienvenida", name: "Bienvenida", category: "Recepción" },
  { id: "oracion", name: "Oración para el servicio", category: "Recepción" },
  { id: "campanero", name: "Campanero", category: "Recepción" },
  { id: "ofrenda", name: "Ofrenda - Pan y Vino", category: "Recepción", multiple: true },
  { id: "monitor", name: "Monitor", category: "Proclamadores" },
  { id: "primera", name: "Primera Lectura", category: "Proclamadores" },
  { id: "salmo", name: "Salmo", category: "Proclamadores" },
  { id: "segunda", name: "Segunda Lectura y Aclamación", category: "Proclamadores" },
  { id: "apoyo", name: "Apoyo al Sacerdote / Ministros", category: "Proclamadores" },
  { id: "turiferario", name: "Turiferario", category: "Servicio del Altar" },
  { id: "navetero", name: "Navetero", category: "Servicio del Altar" },
  { id: "evangeliario", name: "Evangeliario", category: "Servicio del Altar" },
  { id: "cruz", name: "Cruz Alta", category: "Servicio del Altar" },
  { id: "cirial1", name: "Cirial 1", category: "Servicio del Altar" },
  { id: "cirial2", name: "Cirial 2", category: "Servicio del Altar" },
  { id: "colecta", name: "Colecta", category: "Colecta", multiple: true },
  { id: "limpieza-hombres", name: "Limpieza Hombres", category: "Limpieza", multiple: true },
  { id: "limpieza-mujeres", name: "Limpieza Mujeres", category: "Limpieza", multiple: true },
];

const names = ["Laura", "América", "Janeth", "Cristina", "Jesús Adrián", "Paty López", "José Alfredo", "Flor", "Martha González", "Martha Espinoza", "Salvador", "Gaby Mateo", "Melani", "Diana", "Daniel", "Antonio Muro", "Camila", "Lizeth", "Paty Preciado", "Ana Lilia Rangel", "Carlos Lugo"];
export const demoPeople: Person[] = names.map((name, index) => ({ id: `demo-${index + 1}`, name, active: true, services: services.filter((_, i) => (i + index) % 3 !== 0).map((service) => service.id) }));
export const demoAssignments: Assignment = { bienvenida: ["demo-1", "demo-2"], oracion: ["demo-4"], campanero: ["demo-3"], ofrenda: ["demo-5", "demo-6"], monitor: ["demo-7"], primera: ["demo-8"], salmo: ["demo-9"], segunda: ["demo-10"], apoyo: ["demo-11"], turiferario: ["demo-12"], navetero: ["demo-13"], evangeliario: ["demo-14"], cruz: ["demo-15"], cirial1: ["demo-16"], cirial2: ["demo-17"], colecta: ["demo-18", "demo-19", "demo-20"], "limpieza-hombres": ["demo-21"], "limpieza-mujeres": ["demo-4"] };
