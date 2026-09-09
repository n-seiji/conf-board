const COUNTRY_NAMES = [
  "サウナ共和国",
  "推し活連邦",
  "昼寝王国",
  "書籍無制限公国",
  "リモート諸島",
  "有給帝国",
  "まかない連合",
  "ペット同伴領",
  "学び直し共和国",
  "帰省手当王国",
  "ジム通い連邦",
  "コーヒー無限公国",
  "時短勤務諸島",
  "副業自由国",
  "ワーケーション群島",
  "育児応援連合",
  "推しスイーツ王国",
  "マッサージ共和国",
  "フェス休暇領",
  "温泉合衆国",
] as const;

export const COUNTRY_COUNT = COUNTRY_NAMES.length;

export const getCountryName = (countryId: number): string => COUNTRY_NAMES[countryId] ?? "不明の国";
