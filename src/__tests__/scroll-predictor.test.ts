import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrollPredictor } from "@/lib/scroll-predictor";

describe("scroll predictor", () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => {
    t = 1000;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("moves the picture immediately and repaints", () => {
    const p = createScrollPredictor(now);
    const repaint = vi.fn();
    p.repaint = repaint;
    p.scrolled(120);
    p.scrolled(80);
    expect(p.pending()).toBe(200);
    expect(repaint).toHaveBeenCalledTimes(2);
  });

  it("hands over to the real frame once it has had time to arrive", () => {
    const p = createScrollPredictor(now);
    p.scrolled(100);
    t += 10;
    p.onFrame(); // too soon to contain the scroll
    expect(p.pending()).toBe(100);
    t += 300;
    p.onFrame(); // a round trip later: the frame shows it
    expect(p.pending()).toBe(0);
  });

  it("keeps scroll made after the frame was captured", () => {
    const p = createScrollPredictor(now);
    p.scrolled(100);
    t += 400;
    p.scrolled(50);
    t += 20;
    p.onFrame();
    expect(p.pending()).toBe(50);
  });

  it("snaps back when no frame comes (the page couldn't scroll)", () => {
    const p = createScrollPredictor(now);
    const repaint = vi.fn();
    p.repaint = repaint;
    p.scrolled(300);
    vi.advanceTimersByTime(1000);
    expect(p.pending()).toBe(0);
    expect(repaint).toHaveBeenCalledTimes(2);
  });

  it("learns the round trip", () => {
    const p = createScrollPredictor(now);
    for (let i = 0; i < 12; i++) {
      p.scrolled(10);
      t += 400;
      p.onFrame();
      t += 50;
    }
    expect(p.lag()).toBeGreaterThan(300);
    expect(p.lag()).toBeLessThanOrEqual(900);
  });
});
