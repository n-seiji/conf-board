export type PinColorId = 0 | 1 | 2 | 3 | 4 | 5;

export type PinColor = Readonly<{
  id: PinColorId;
  name: string;
  hex: string;
}>;

export const PIN_COLORS = [
  { id: 0, name: "コーラル", hex: "#FF8A80" },
  { id: 1, name: "レモン", hex: "#FFE082" },
  { id: 2, name: "ラベンダー", hex: "#B39DDB" },
  { id: 3, name: "スカイ", hex: "#81D4FA" },
  { id: 4, name: "ピーチ", hex: "#FFAB91" },
  { id: 5, name: "ホワイト", hex: "#FFFFFF" },
] as const satisfies readonly PinColor[];

export const DEFAULT_PIN_COLOR_ID: PinColorId = 5;

export const isPinColorId = (value: unknown): value is PinColorId =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;

export const pinColorHex = (id: PinColorId): string => PIN_COLORS[id].hex;
