/**
 * 効果音 (Web Audio)。AudioContext はユーザー操作 (クリック) で初期化する。
 */
export class BoardAudio {
  private context: AudioContext | null = null;
  private enabled = true;

  /** どこかのクリックで一度だけ呼ぶ。AudioContext を初期化する。 */
  unlock(): void {
    if (this.context) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.context = new Ctor();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** ピン着地音: sine 440Hz、200ms 減衰。 */
  playLanding(): void {
    this.playTone(440, 0.2);
  }

  /** 送信音: sine 880→1320Hz、120ms。 */
  playSend(): void {
    const ctx = this.context;
    if (!ctx || !this.enabled) return;
    this.ensureResumed(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  private playTone(frequency: number, durationSec: number): void {
    const ctx = this.context;
    if (!ctx || !this.enabled) return;
    this.ensureResumed(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec);
  }

  /**
   * ブースで 1 日動かしていると OS のスリープ・タブの非表示化等で AudioContext が
   * suspended になり、以後ずっと無音になることがある。再生の直前に毎回チェックして
   * 必要なら resume する。
   */
  private ensureResumed(ctx: AudioContext): void {
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
  }
}
