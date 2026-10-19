// 表示の明るさ。既定は明るい表示で、端末がダークモードでも変えない。
// 切り替えたいときだけサイドバーから選び、その人のブラウザに覚えておく。

export type Theme = "light" | "dark";

const KEY = "aletheia.theme";

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme): void {
  // data-theme は、ページを埋め込む側（プレビューなど）が書き換えることがあるため、別の名前を使う
  document.documentElement.dataset["color"] = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // 覚えられなくても、表示は切り替わる
  }
}
