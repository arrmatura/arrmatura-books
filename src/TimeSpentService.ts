import { WebClientService } from "arrmatura-web/core";

export class TimeSpentService extends WebClientService {
  declare seconds: number;

  constructor() {
    super();
    this.__defineStoredProperty("seconds", (v) => Number(v ?? 0));
  }

  __init(): void {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") this.up({ seconds: this.seconds + 1 });
    }, 1000);
    this.defer(() => clearInterval(timer));
  }
}
