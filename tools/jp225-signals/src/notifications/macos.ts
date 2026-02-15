import { execFile, execFileSync } from "node:child_process";
import { platform } from "node:os";

let osascriptAvailable: boolean | null = null;

function checkOsascript(): boolean {
  if (osascriptAvailable !== null) {
    return osascriptAvailable;
  }
  if (platform() !== "darwin") {
    osascriptAvailable = false;
    return false;
  }
  try {
    execFileSync("which", ["osascript"], { stdio: "ignore" });
    osascriptAvailable = true;
  } catch {
    osascriptAvailable = false;
  }
  return osascriptAvailable;
}

/**
 * Send a macOS notification using osascript.
 */
export async function sendMacOSNotification(
  title: string,
  body: string,
  sound: string = "Glass",
): Promise<void> {
  if (!checkOsascript()) {
    return;
  }

  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" sound name "${sound}"`;

  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
