import * as v from "valibot";
import { saveArrivedImage } from "./arrived-image";
import { BoardAudio } from "../shared/audio";
import { type GlobeHandle, createGlobe } from "../globe/index";
import { pinLatLon } from "../globe/pins";
import { ApiError, createPost } from "../shared/api";
import { DEFAULT_PIN_COLOR_ID, PIN_COLORS, type PinColorId, isPinColorId } from "../shared/colors";
import { getCountryName } from "../shared/countries";
import {
  BODY_MAX,
  NICKNAME_MAX,
  clampByCodePoints,
  codePointLength,
  createPostRequestSchema,
} from "../shared/schemas";
import { readLocalStorage, writeLocalStorage } from "../shared/storage";
import type { Post } from "../shared/types";
import "../styles/base.css";
import "./phone.css";

const LAUNCH_DURATION_MS = 900;
const COLOR_STORAGE_KEY = "miive:phone:color";

type Screen = "form" | "sending" | "arrived";

type FormState = Readonly<{
  nickname: string;
  body: string;
}>;

const loadStoredColor = (): PinColorId => {
  const raw = readLocalStorage(COLOR_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return isPinColorId(parsed) ? parsed : DEFAULT_PIN_COLOR_ID;
};

const storeColor = (color: PinColorId): void => {
  writeLocalStorage(COLOR_STORAGE_KEY, String(color));
};

const audio = new BoardAudio();
document.addEventListener(
  "click",
  () => {
    audio.unlock();
  },
  { once: true, capture: true },
);

const app = document.getElementById("app");
if (!app) {
  throw new Error("app root element not found");
}
const root = app;

let screen: Screen = "form";
let lastForm: FormState = { nickname: "", body: "" };
let selectedColor: PinColorId = loadStoredColor();
let lastPost: Post | null = null;
let arrivedGlobe: GlobeHandle | null = null;
let pendingClientId = "";

/**
 * サーバーの (英語の) バリデーション文言をそのまま出さず、利用者向けの日本語文言に変換する。
 * 400 系はニックネーム/本文の文字数制限の説明に丸め、それ以外は汎用の再試行メッセージにする。
 */
const toUserFacingErrorMessage = (reason: unknown): string => {
  if (reason instanceof ApiError && reason.status === 400) {
    return "ニックネームは 1〜20 文字、内容は 1〜80 文字で入力してください";
  }
  return "送信に失敗しました。もう一度お試しください";
};

const disposeArrivedGlobe = (): void => {
  arrivedGlobe?.dispose();
  arrivedGlobe = null;
};

const goTo = (next: Screen): void => {
  if (screen === "arrived" && next !== "arrived") {
    disposeArrivedGlobe();
  }
  screen = next;
  render();
};

const showFormWithError = (message: string): void => {
  screen = "form";
  root.innerHTML = "";
  root.appendChild(renderForm(message));
};

const render = (): void => {
  root.innerHTML = "";
  if (screen === "form") {
    root.appendChild(renderForm());
  } else if (screen === "sending") {
    root.appendChild(renderSending());
  } else {
    root.appendChild(renderArrived());
  }
};

// --- form ---

const renderForm = (errorMessage?: string): HTMLElement => {
  const screenEl = document.createElement("div");
  screenEl.className = "phone-screen";

  screenEl.innerHTML = `
    <p class="phone-brand">miive × Go Conference</p>
    <h1 class="phone-heading">気に入っている福利厚生は<br />どんなものですか?</h1>
    <p class="phone-subtext">あるいは、どんな福利厚生がほしいですか?</p>
    <form id="phone-form" class="phone-card" novalidate>
      <div class="phone-field">
        <label for="phone-nickname">ニックネーム</label>
        <input
          id="phone-nickname"
          class="phone-input"
          type="text"
          maxlength="${NICKNAME_MAX}"
          autocomplete="off"
          placeholder="ニックネーム"
        />
      </div>
      <div class="phone-field">
        <label for="phone-body">内容</label>
        <textarea
          id="phone-body"
          class="phone-textarea"
          maxlength="${BODY_MAX}"
          placeholder="例: 週 1 回のサウナ手当がほしい"
        ></textarea>
        <span class="phone-counter"><span class="phone-counter-n">0</span> / ${BODY_MAX}</span>
      </div>
      <div class="phone-field">
        <label id="phone-color-label">あなたの色</label>
        <div class="phone-color-swatches" role="group" aria-labelledby="phone-color-label">
          ${PIN_COLORS.map(
            (c) => `
              <button
                type="button"
                class="phone-color-swatch"
                data-color-id="${c.id}"
                style="--swatch-color: ${c.hex}"
                aria-label="${c.name}"
                aria-pressed="${c.id === selectedColor}"
              ></button>
            `,
          ).join("")}
        </div>
      </div>
      <p class="phone-error"></p>
    </form>
    <button type="submit" form="phone-form" class="phone-submit">世界に届ける</button>
    <img class="phone-gopher" src="/gopher-surf.png" alt="" />
    <div class="phone-footer">
      <p>miive</p>
    </div>
  `;

  const form = screenEl.querySelector<HTMLFormElement>("#phone-form");
  const nicknameInput = screenEl.querySelector<HTMLInputElement>("#phone-nickname");
  const bodyTextarea = screenEl.querySelector<HTMLTextAreaElement>("#phone-body");
  const counter = screenEl.querySelector<HTMLSpanElement>(".phone-counter-n");
  const errorEl = screenEl.querySelector<HTMLParagraphElement>(".phone-error");
  const swatchButtons = screenEl.querySelectorAll<HTMLButtonElement>(".phone-color-swatch");

  if (nicknameInput) nicknameInput.value = lastForm.nickname;
  if (bodyTextarea) bodyTextarea.value = lastForm.body;
  if (counter) counter.textContent = String(codePointLength(lastForm.body));
  if (errorMessage && errorEl) errorEl.textContent = errorMessage;

  for (const button of swatchButtons) {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.colorId);
      if (!isPinColorId(id)) return;
      selectedColor = id;
      storeColor(id);
      for (const other of swatchButtons) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
  }

  bodyTextarea?.addEventListener("input", () => {
    const clamped = clampByCodePoints(bodyTextarea.value, BODY_MAX);
    if (clamped !== bodyTextarea.value) bodyTextarea.value = clamped;
    if (counter) counter.textContent = String(codePointLength(bodyTextarea.value));
  });

  nicknameInput?.addEventListener("input", () => {
    const clamped = clampByCodePoints(nicknameInput.value, NICKNAME_MAX);
    if (clamped !== nicknameInput.value) nicknameInput.value = clamped;
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const nicknameRaw = nicknameInput?.value ?? "";
    const bodyRaw = bodyTextarea?.value ?? "";
    lastForm = { nickname: nicknameRaw, body: bodyRaw };

    const clientId = crypto.randomUUID();
    const result = v.safeParse(createPostRequestSchema, {
      nickname: nicknameRaw,
      body: bodyRaw,
      clientId,
      color: selectedColor,
    });
    if (!result.success) {
      showFormWithError(result.issues[0]?.message ?? "入力内容を確認してください");
      return;
    }
    pendingClientId = clientId;
    lastForm = { nickname: result.output.nickname, body: result.output.body };
    goTo("sending");
  });

  return screenEl;
};

// --- sending ---

const renderSending = (): HTMLElement => {
  const screenEl = document.createElement("div");
  screenEl.className = "phone-screen";
  screenEl.innerHTML = `
    <div class="phone-sending">
      <div class="phone-sending-stage">
        <div class="phone-send-card">
          <span class="phone-send-card__color-band"></span>
          <p class="phone-send-card__nickname"></p>
          <p class="phone-send-card__body"></p>
        </div>
        <img class="phone-send-gopher" src="/gopher-surf.png" alt="" />
        <svg class="phone-splash-svg" viewBox="0 0 160 60" fill="none">
          <path d="M10 40 Q 40 10 70 35 T 150 30" />
          <path d="M0 48 Q 45 20 80 45 T 160 40" />
          <path d="M20 55 Q 55 30 90 52 T 155 50" />
        </svg>
      </div>
      <p class="phone-sending-caption">いってきます!</p>
    </div>
  `;

  const nicknameEl = screenEl.querySelector<HTMLParagraphElement>(".phone-send-card__nickname");
  const bodyEl = screenEl.querySelector<HTMLParagraphElement>(".phone-send-card__body");
  const stage = screenEl.querySelector<HTMLDivElement>(".phone-sending-stage");
  const colorBand = screenEl.querySelector<HTMLSpanElement>(".phone-send-card__color-band");
  if (nicknameEl) nicknameEl.textContent = lastForm.nickname;
  if (bodyEl) bodyEl.textContent = lastForm.body;
  const colorHex = PIN_COLORS[selectedColor].hex;
  if (colorBand) colorBand.style.backgroundColor = colorHex;

  const clientId = pendingClientId;

  const animationDone = new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      audio.playSend();
      stage?.classList.add("phone-send-launch");
      setTimeout(resolve, LAUNCH_DURATION_MS);
    });
  });

  const apiCall = createPost({
    nickname: lastForm.nickname,
    body: lastForm.body,
    clientId,
    color: selectedColor,
  });

  Promise.allSettled([animationDone, apiCall]).then(([, apiResult]) => {
    if (screen !== "sending") return;
    if (apiResult.status === "fulfilled") {
      lastPost = apiResult.value.post;
      goTo("arrived");
      return;
    }
    showFormWithError(toUserFacingErrorMessage(apiResult.reason));
  });

  return screenEl;
};

// --- arrived ---

const renderArrived = (): HTMLElement => {
  const screenEl = document.createElement("div");
  screenEl.className = "phone-screen";
  const post = lastPost;
  const countryName = post ? getCountryName(post.countryId) : "";
  const seq = post?.seq ?? 0;
  const colorInfo = PIN_COLORS[post?.color ?? DEFAULT_PIN_COLOR_ID];

  screenEl.innerHTML = `
    <div class="phone-arrived">
      <h1 class="phone-arrived-heading">
        <span class="phone-arrived-heading__part phone-arrived-heading__country"></span>
        <span class="phone-arrived-heading__part">届きました!</span>
      </h1>
      <p class="phone-arrived-seq">あなたの願いは ${seq} 番目の願いです</p>
      <p class="phone-arrived-color">
        あなたの色: <span class="phone-arrived-color__dot"></span><span class="phone-arrived-color__name"></span>
      </p>
      <div class="phone-arrived-globe"></div>
      <div class="phone-arrived-actions">
        <button type="button" class="phone-action-button phone-action-share">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-6.8L4.5 22H1.4l8.2-9.4L1 2h7.2l5 6.2L18.9 2zm-1.2 18h1.7L7.4 4H5.6l12.1 16z"/></svg>
          <span>X で投稿</span>
        </button>
        <button type="button" class="phone-action-button phone-action-save">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>画像を保存</span>
        </button>
        <p class="phone-error"></p>
      </div>
      <button type="button" class="phone-again-link">もう一度願う →</button>
    </div>
    <img class="phone-arrived-gopher" src="/gopher-surf.png" alt="" />
  `;

  const countryEl = screenEl.querySelector<HTMLSpanElement>(".phone-arrived-heading__country");
  if (countryEl) countryEl.textContent = `${countryName}に`;

  const colorDotEl = screenEl.querySelector<HTMLSpanElement>(".phone-arrived-color__dot");
  if (colorDotEl) colorDotEl.style.setProperty("--dot-color", colorInfo.hex);
  const colorNameEl = screenEl.querySelector<HTMLSpanElement>(".phone-arrived-color__name");
  if (colorNameEl) colorNameEl.textContent = colorInfo.name;

  const globeHost = screenEl.querySelector<HTMLDivElement>(".phone-arrived-globe");
  if (globeHost && post) {
    disposeArrivedGlobe();
    const globe = createGlobe(globeHost, {
      preserveDrawingBuffer: true,
      autoRotate: true,
    });
    const [lat, lon] = pinLatLon(post);
    globe.setRotationTo(lat, lon);
    globe.addPin(post, { animate: true });
    globe.onPinArrived(post.id, () => {
      audio.playLanding();
    });
    arrivedGlobe = globe;
  }

  const errorHost = screenEl.querySelector<HTMLParagraphElement>(
    ".phone-arrived-actions .phone-error",
  );

  screenEl
    .querySelector<HTMLButtonElement>(".phone-action-share")
    ?.addEventListener("click", () => {
      if (!post) return;
      const text = `「${post.body}」— #GoConference のブースで ${countryName} に願いを届けました! #miive`;
      const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(url, "_blank", "noopener");
    });

  screenEl
    .querySelector<HTMLButtonElement>(".phone-action-save")
    ?.addEventListener("click", async () => {
      if (!post) return;
      if (errorHost) errorHost.textContent = "";
      try {
        arrivedGlobe?.render();
        await saveArrivedImage(post, countryName, globeHost);
      } catch {
        if (errorHost) errorHost.textContent = "画像の保存に失敗しました。もう一度お試しください。";
      }
    });

  screenEl.querySelector<HTMLButtonElement>(".phone-again-link")?.addEventListener("click", () => {
    lastForm = { nickname: "", body: "" };
    goTo("form");
  });

  return screenEl;
};

render();
