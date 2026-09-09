import { CELEBRATION_THRESHOLD } from "../shared/constants";

/** 紙吹雪演出からメッセージ球への切り替えまでの待ち時間。 */
const CELEBRATE_TO_MESSAGE_DELAY_MS = 5000;

/** UI state only: never changes the post count or the server's celebrated flag. */
export class MilestoneState {
  available = false;
  message = false;
  private deadline: number | null = null;

  sync(total: number) {
    this.available = total >= CELEBRATION_THRESHOLD;
    if (!this.available) {
      this.message = false;
      this.deadline = null;
    }
  }
  celebrate(now: number) {
    if (!this.available) return;
    this.message = false;
    this.deadline = now + CELEBRATE_TO_MESSAGE_DELAY_MS;
  }
  tick(now: number) {
    if (this.deadline !== null && now >= this.deadline) {
      this.message = true;
      this.deadline = null;
    }
  }
  toggle() {
    if (!this.available) return;
    this.deadline = null;
    this.message = !this.message;
  }
}
