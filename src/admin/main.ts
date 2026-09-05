import { ApiError, BoardSocket, deletePost, resetBoard } from "../shared/api";
import { PIN_COLORS } from "../shared/colors";
import { getCountryName } from "../shared/countries";
import type { Post } from "../shared/types";
import "../styles/base.css";
import "./admin.css";

const TOKEN_STORAGE_KEY = "conf-board.adminToken";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const readStoredToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const writeStoredToken = (token: string): void => {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage が使えない環境でも致命的ではないため無視する
  }
};

const stripTokenFromUrl = (): void => {
  const url = new URL(location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const resolveInitialToken = (): string => {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("token");
  if (fromQuery) {
    writeStoredToken(fromQuery);
    stripTokenFromUrl();
    return fromQuery;
  }
  return readStoredToken();
};

type State = {
  token: string;
  posts: readonly Post[];
  total: number;
  celebrated: boolean;
  connected: boolean;
  loaded: boolean;
  error: string | null;
  pendingIds: ReadonlySet<string>;
};

const buildDom = (
  root: HTMLElement,
): Readonly<{
  tokenInput: HTMLInputElement;
  resetButton: HTMLButtonElement;
  connectionLabel: HTMLDivElement;
  statusLabel: HTMLDivElement;
  errorLabel: HTMLParagraphElement;
  tableWrap: HTMLDivElement;
}> => {
  root.innerHTML = "";

  const screen = document.createElement("div");
  screen.className = "admin-screen";

  const panel = document.createElement("div");
  panel.className = "admin-panel";
  screen.appendChild(panel);

  const title = document.createElement("h1");
  title.className = "admin-title";
  title.textContent = "conf-board 管理画面";
  panel.appendChild(title);

  const tokenCard = document.createElement("div");
  tokenCard.className = "admin-card";
  panel.appendChild(tokenCard);

  const tokenRow = document.createElement("div");
  tokenRow.className = "admin-token-row";
  tokenCard.appendChild(tokenRow);

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "管理トークンを入力";
  tokenInput.autocomplete = "off";
  tokenRow.appendChild(tokenInput);

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "admin-button admin-button--danger";
  resetButton.textContent = "全件リセット";
  tokenRow.appendChild(resetButton);

  const connectionLabel = document.createElement("div");
  connectionLabel.className = "admin-connection";
  tokenCard.appendChild(connectionLabel);

  const errorLabel = document.createElement("p");
  errorLabel.className = "admin-error";
  tokenCard.appendChild(errorLabel);

  const listCard = document.createElement("div");
  listCard.className = "admin-card";
  panel.appendChild(listCard);

  const statusRow = document.createElement("div");
  statusRow.className = "admin-status-row";
  listCard.appendChild(statusRow);

  const statusLabel = document.createElement("div");
  statusRow.appendChild(statusLabel);

  const tableWrap = document.createElement("div");
  tableWrap.className = "admin-table-wrap";
  listCard.appendChild(tableWrap);

  root.appendChild(screen);

  return {
    tokenInput,
    resetButton,
    connectionLabel,
    statusLabel,
    errorLabel,
    tableWrap,
  };
};

const formatError = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.status === 401) return "トークンが正しくありません (401)";
    if (error.status === 404) return "対象の投稿が見つかりません (404)";
    return `エラーが発生しました (${error.status}): ${error.message}`;
  }
  return "通信エラーが発生しました";
};

const renderTable = (
  tableWrap: HTMLDivElement,
  state: State,
  onDelete: (id: string) => void,
): void => {
  tableWrap.innerHTML = "";

  if (!state.loaded) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "読み込み中...";
    tableWrap.appendChild(empty);
    return;
  }

  if (state.posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-empty";
    empty.textContent = "投稿はまだありません";
    tableWrap.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "admin-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["No.", "国名", "色", "ニックネーム", "本文", "日時", ""]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sorted = [...state.posts].sort((a, b) => b.seq - a.seq);

  for (const post of sorted) {
    const row = document.createElement("tr");

    const seqCell = document.createElement("td");
    seqCell.textContent = String(post.seq);
    row.appendChild(seqCell);

    const countryCell = document.createElement("td");
    countryCell.textContent = getCountryName(post.countryId);
    row.appendChild(countryCell);

    const colorCell = document.createElement("td");
    const colorWrap = document.createElement("span");
    colorWrap.className = "admin-color-cell";
    const colorDot = document.createElement("span");
    colorDot.className = "admin-color-dot";
    const pinColor = PIN_COLORS[post.color];
    colorDot.style.backgroundColor = pinColor.hex;
    const colorLabel = document.createElement("span");
    colorLabel.textContent = pinColor.name;
    colorWrap.appendChild(colorDot);
    colorWrap.appendChild(colorLabel);
    colorCell.appendChild(colorWrap);
    row.appendChild(colorCell);

    const nicknameCell = document.createElement("td");
    nicknameCell.textContent = post.nickname;
    row.appendChild(nicknameCell);

    const bodyCell = document.createElement("td");
    bodyCell.className = "admin-col-body";
    bodyCell.textContent = post.body;
    row.appendChild(bodyCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = dateFormatter.format(new Date(post.createdAt));
    row.appendChild(dateCell);

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "admin-delete-button";
    deleteButton.textContent = "削除";
    deleteButton.disabled = !state.token || state.pendingIds.has(post.id);
    deleteButton.addEventListener("click", () => onDelete(post.id));
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  }

  table.appendChild(tbody);
  tableWrap.appendChild(table);
};

const main = (): void => {
  const app = document.getElementById("app");
  if (!app) return;

  const dom = buildDom(app);

  const state: State = {
    token: resolveInitialToken(),
    posts: [],
    total: 0,
    celebrated: false,
    connected: false,
    loaded: false,
    error: null,
    pendingIds: new Set(),
  };

  dom.tokenInput.value = state.token;

  const renderStatus = (): void => {
    dom.statusLabel.textContent = `投稿数: ${state.total}件${state.celebrated ? " (目標達成 済)" : ""}`;
    dom.connectionLabel.textContent = state.connected ? "接続中" : "切断中 (再接続を試みています)";
    dom.connectionLabel.classList.toggle("admin-connection--offline", !state.connected);
    dom.errorLabel.textContent = state.error ?? "";
    dom.resetButton.disabled = !state.token;
  };

  const renderAll = (): void => {
    renderStatus();
    renderTable(dom.tableWrap, state, handleDelete);
  };

  const setPending = (id: string, pending: boolean): void => {
    const next = new Set(state.pendingIds);
    if (pending) {
      next.add(id);
    } else {
      next.delete(id);
    }
    state.pendingIds = next;
    renderAll();
  };

  const handleDelete = (id: string): void => {
    if (!state.token) return;
    setPending(id, true);
    deletePost(id, state.token)
      .then(() => {
        state.error = null;
      })
      .catch((error: unknown) => {
        state.error = formatError(error);
      })
      .finally(() => {
        setPending(id, false);
      });
  };

  dom.tokenInput.addEventListener("change", () => {
    state.token = dom.tokenInput.value.trim();
    writeStoredToken(state.token);
    state.error = null;
    renderAll();
  });

  dom.resetButton.addEventListener("click", () => {
    if (!state.token) return;
    const ok = confirm("すべての投稿を削除します。よろしいですか?");
    if (!ok) return;
    dom.resetButton.disabled = true;
    resetBoard(state.token)
      .then(() => {
        state.error = null;
      })
      .catch((error: unknown) => {
        state.error = formatError(error);
      })
      .finally(() => {
        renderAll();
      });
  });

  const socket = new BoardSocket({
    onSnapshot: (posts, total, celebrated) => {
      state.posts = posts;
      state.total = total;
      state.celebrated = celebrated;
      state.loaded = true;
      renderAll();
    },
    onPost: (post, total, celebrated) => {
      if (!state.posts.some((existing) => existing.id === post.id)) {
        state.posts = [...state.posts, post];
      }
      state.total = total;
      state.celebrated = celebrated;
      renderAll();
    },
    onDelete: (id, total) => {
      state.posts = state.posts.filter((post) => post.id !== id);
      state.total = total;
      renderAll();
    },
    onReset: () => {
      state.posts = [];
      state.total = 0;
      state.celebrated = false;
      renderAll();
    },
    onConnectionChange: (connected) => {
      state.connected = connected;
      renderAll();
    },
  });

  socket.connect();
  renderAll();
};

main();
