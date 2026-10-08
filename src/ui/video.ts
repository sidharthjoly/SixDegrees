import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';
import { STORY_WIDTH, drawStory, storyPlan, type StoryCard } from '../card';

/*
 * The share video: the story card building itself up (card.ts draws each frame), encoded
 * to H.264 MP4 with WebCodecs, which every app that takes video accepts. Encoding runs
 * faster than real time and gives every frame, where recording the canvas live would drop
 * some. This module is loaded only when someone asks for a video; share.ts checks that the
 * browser can encode before offering it.
 */

const FPS = 30;
/**
 * Full HD where the encoder allows, else 720p, which every H.264 encoder can do. Always
 * Baseline profile: Safari reports High profile as supported, then never returns a frame.
 */
const SIZES = [
  { width: 1080, height: 1920, fullCodecString: 'avc1.42002a' },
  { width: 720, height: 1280, fullCodecString: 'avc1.42001f' },
];
/** An encoder that takes this long over one frame has stalled (some claim support they don't have). */
const STALL_MS = 6000;

/** `work`, or an error if it hasn't finished within STALL_MS. */
function unlessStalled<T>(work: Promise<T>): Promise<T> {
  let timer = 0;
  const stalled = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('The video encoder stopped responding')), STALL_MS);
  });
  return Promise.race([work, stalled]).finally(() => clearTimeout(timer));
}

export async function storyVideo(card: StoryCard, onProgress: (done: number) => void): Promise<Blob> {
  let size: (typeof SIZES)[number] | undefined;
  for (const s of SIZES) {
    if (await canEncodeVideo('avc', { ...s, quality: QUALITY_HIGH, frameRate: FPS })) {
      size = s;
      break;
    }
  }
  if (!size) throw new Error('This browser can’t make videos.');

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas isn’t available');

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { codec: 'avc', fullCodecString: size.fullCodecString, quality: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();

  const frames = Math.ceil(storyPlan(card).end * FPS);
  const scale = size.width / STORY_WIDTH;
  try {
    for (let i = 0; i < frames; i++) {
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawStory(ctx, card, i / FPS);
      await unlessStalled(source.add(i / FPS, 1 / FPS));
      onProgress((i + 1) / frames);
      // Let the page paint the progress now and then.
      if (i % 8 === 7) await new Promise((r) => setTimeout(r));
    }
    await unlessStalled(output.finalize());
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  }
  if (!target.buffer) throw new Error('Couldn’t make the video');
  return new Blob([target.buffer], { type: 'video/mp4' });
}
