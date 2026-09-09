/** localStorage が使えない環境 (プライベートモード等) でも例外を投げずに済ませる。 */
export const readLocalStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeLocalStorage = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage が使えない環境でも致命的ではないため無視する
  }
};
