//@ts-check
/// <reference types="@cloudflare/workers-types" />
import MP4Box from "mp4box";
import { H264Decoder } from "h264decoder";
import { UPNG } from "./UPNG";

// Configuration
const FRAME_INTERVAL_SECONDS = 1;

// Multipart boundary for the response
const BOUNDARY =
  "----VideoFrameBoundary" + Math.random().toString(16).substring(2);

export interface Env {
  // Define any environment variables here
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Check if the request path is correct
    if (url.pathname !== "/extract-frames") {
      return new Response(
        "Use /extract-frames endpoint with a video URL parameter",
        {
          status: 400,
        },
      );
    }

    // Get video URL from query parameter
    const videoUrl = url.searchParams.get("url");
    if (!videoUrl) {
      return new Response("Missing video URL parameter", {
        status: 400,
      });
    }

    try {
      // Create a ReadableStream to output the multipart response
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();

      // Start processing in the background
      ctx.waitUntil(processVideo(videoUrl, writer));

      // Return a streaming response
      return new Response(readable, {
        headers: {
          "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
      });
    }
  },
};

/**
 * Process the video and write PNG frames to the response
 */
async function processVideo(
  videoUrl: string,
  writer: WritableStreamDefaultWriter,
): Promise<void> {
  try {
    // Initialize MP4Box for parsing
    const mp4boxfile = MP4Box.createFile();

    // Track information
    let videoTrackId: number = -1;
    let videoWidth: number = 0;
    let videoHeight: number = 0;
    let timeScale: number = 0;

    // For frame extraction
    let frameTimestamps: number[] = [];
    let decoder: H264Decoder = null;
    let frameCount = 0;

    // Set up MP4Box callbacks
    mp4boxfile.onError = (error: string) => {
      console.error("MP4Box error:", error);
      writer.abort(new Error(error));
    };

    mp4boxfile.onReady = async (info: any) => {
      console.log("MP4Box ready with file info:", info);

      // Find the video track
      for (const track of info.tracks) {
        if (
          track.type === "video" ||
          (track.video && track.codec.startsWith("avc1"))
        ) {
          videoTrackId = track.id;
          videoWidth = track.video.width;
          videoHeight = track.video.height;
          timeScale = track.timescale;

          // Calculate timestamps for 1-second interval frames
          const duration = track.duration / timeScale;
          for (let time = 0; time < duration; time += FRAME_INTERVAL_SECONDS) {
            frameTimestamps.push(Math.floor(time * timeScale));
          }

          break;
        }
      }

      if (videoTrackId === -1) {
        throw new Error("No compatible video track found in the MP4 file");
      }

      // Initialize H264 decoder
      decoder = new H264Decoder();

      // Set up sample extraction
      mp4boxfile.onSamples = async (
        trackId: number,
        _user: any,
        samples: any[],
      ) => {
        if (trackId !== videoTrackId) return;

        for (const sample of samples) {
          // Check if we need this frame based on our timestamps
          const currentTimestamp = sample.cts;
          const shouldExtract = frameTimestamps.some(
            (ts) =>
              currentTimestamp >= ts && currentTimestamp < ts + timeScale / 30,
          );

          if (shouldExtract) {
            await processFrame(sample, decoder, frameCount++, writer);
          }
        }
      };

      // Configure sample extraction
      mp4boxfile.setExtractionOptions(videoTrackId, null, {
        nbSamples: 1000, // Process in chunks
        rapAlignement: true,
      });

      // Start extraction
      mp4boxfile.start();
    };

    // Fetch the video and stream it to MP4Box
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch video: ${response.status} ${response.statusText}`,
      );
    }

    const reader = response.body!.getReader();
    let offset = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Process the chunk with MP4Box
      const chunk = value;
      chunk.fileStart = offset;
      mp4boxfile.appendBuffer(chunk);
      offset += chunk.byteLength;
    }

    // Finalize MP4Box processing
    mp4boxfile.flush();

    // Complete the multipart response
    await writer.write(createMultipartEnd());
    await writer.close();
  } catch (error) {
    console.error("Error processing video:", error);
    await writer.abort(error);
  }
}

/**
 * Process a single H.264 frame, decode it, and convert to PNG
 */
async function processFrame(
  sample: any,
  decoder: H264Decoder,
  frameNumber: number,
  writer: WritableStreamDefaultWriter,
): Promise<void> {
  // Decode the H.264 sample
  const result = decoder.decode(new Uint8Array(sample.data));

  if (result === H264Decoder.PIC_RDY) {
    const width = decoder.width;
    const height = decoder.height;

    // Get the YUV data from the decoder
    const yuvData = decoder.pic;

    // Convert YUV420 to RGB
    const rgbData = YUV2RGB(yuvData, width, height);

    // Create RGBA data (adding alpha channel)
    const rgbaData = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < rgbData.length; i += 3, j += 4) {
      rgbaData[j] = rgbData[i]; // R
      rgbaData[j + 1] = rgbData[i + 1]; // G
      rgbaData[j + 2] = rgbData[i + 2]; // B
      rgbaData[j + 3] = 255; // A (fully opaque)
    }

    // Convert to PNG using UPNG.js
    const pngData = UPNG.encode([rgbaData.buffer], width, height, 0);

    // Create a multipart section for this PNG
    const multipartSection = createMultipartSection(
      frameNumber,
      sample.cts / sample.timescale,
      new Uint8Array(pngData),
    );

    // Write to the response stream
    await writer.write(multipartSection);
  }
}

/**
 * Convert YUV420 to RGB
 */
function YUV2RGB(yuv: Uint8Array, width: number, height: number): Uint8Array {
  const uStart = width * height;
  const halfWidth = Math.floor(width / 2);
  const vStart = uStart + Math.floor(uStart / 4);
  const rgb = new Uint8Array(width * height * 3);

  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yIdx = y * width + x;
      const yValue = yuv[yIdx];

      const colorIndex = Math.floor(y / 2) * halfWidth + Math.floor(x / 2);
      const uValue = yuv[uStart + colorIndex] - 128;
      const vValue = yuv[vStart + colorIndex] - 128;

      // YUV to RGB conversion
      let r = yValue + 1.402 * vValue;
      let g = yValue - 0.344 * uValue - 0.714 * vValue;
      let b = yValue + 1.772 * uValue;

      // Clamp values to 0-255
      rgb[i++] = Math.max(0, Math.min(255, Math.round(r)));
      rgb[i++] = Math.max(0, Math.min(255, Math.round(g)));
      rgb[i++] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }

  return rgb;
}

/**
 * Create a multipart section for a PNG image
 */
function createMultipartSection(
  frameNumber: number,
  timestamp: number,
  pngData: Uint8Array,
): Uint8Array {
  const headers = [
    `--${BOUNDARY}`,
    `Content-Disposition: form-data; name="frame"; filename="frame_${frameNumber}_${timestamp.toFixed(
      2,
    )}s.png"`,
    "Content-Type: image/png",
    "",
    "",
  ].join("\r\n");

  const headersBytes = new TextEncoder().encode(headers);
  const footerBytes = new TextEncoder().encode("\r\n");

  const result = new Uint8Array(
    headersBytes.length + pngData.length + footerBytes.length,
  );
  result.set(headersBytes, 0);
  result.set(pngData, headersBytes.length);
  result.set(footerBytes, headersBytes.length + pngData.length);

  return result;
}

/**
 * Create the end marker for the multipart content
 */
function createMultipartEnd(): Uint8Array {
  return new TextEncoder().encode(`--${BOUNDARY}--\r\n`);
}
