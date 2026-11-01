const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// Chat previews are resolved offscreen before they are rendered, so checks must
// wait for the image load instead of inspecting the DOM synchronously.
export async function waitFor(check: () => unknown, message: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (check()) return;
    await frame();
  }
  throw new Error(message);
}

export const tick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));
