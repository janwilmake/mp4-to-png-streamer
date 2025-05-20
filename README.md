Video processing is very hard and not really done much yet on Cloudflare. Recently gemini has shown though that their AI can understand videos. They do this by efficiently parsing the video file into a set of images on a 1 frame per second basis (source needed).

However, most AI models already allow for image analysis, but not video! What if we could bring this same capability to other AI models like ChatGPT and Claude?

After some research I found that we don't need ffmpeg for mp4 processing, which would potentially make it possible to stream any h264 encoded mp4 over a cloudflare worker to extract frames from it.

For the original prompt that yielded the initial full implementation containing all needed context, see: https://www.lmpify.com/how-could-i-stream-a-m0bqde0
