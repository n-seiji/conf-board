/** UI state only: never changes the post count or the server's celebrated flag. */
export class MilestoneState {
  available = false;
  message = false;
  private deadline: number | null = null;

  sync(total: number) {
    this.available = total >= 150;
    if (!this.available) {
      this.message = false;
      this.deadline = null;
    }
  }
  celebrate(now: number) {
    if (!this.available) return;
    this.message = false;
    this.deadline = now + 5000;
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
