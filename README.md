Video processing is very hard and not really done much yet on Cloudflare. Recently gemini has shown though that their AI can understand videos. They do this by efficiently parsing the video file into a set of images on a 1 frame per second basis (source needed).

However, most AI models already allow for image analysis, but not video! What if we could bring this same capability to other AI models like ChatGPT and Claude?

After some research I found that we don't need ffmpeg for mp4 processing, which would potentially make it possible to stream any h264 encoded mp4 over a cloudflare worker to extract frames from it.

First I had to figure out the hard part: running h264 decoding in a cloudflare worker via a wasm. Maybe, https://github.com/gliese1337/h264decoder could be used: https://www.lmpify.com/httpsuithubcomg-vlvgyw0

After that, brining that together with mp4box and UPNG.js, I created a simple prompt that yielded the initial full implementation containing all needed context, see: https://www.lmpify.com/how-could-i-stream-a-m0bqde0

Unfortunately it didn't immediatlely work. maybe this can be a good starting point though for others to try making this work.

```
✘ [ERROR] service core:user:mp4-to-png-streamer: Uncaught CompileError: WasmModuleObject::Compile(): expected magic word 00 61 73 6d, found 22 75 73 65 @+0



✘ [ERROR] The Workers runtime failed to start. There is likely additional logging output above.
```
