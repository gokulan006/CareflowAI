import { useState, useRef, useEffect } from "react";
import { Mic, Send, Check, X, Loader2 } from "lucide-react";
import { uploadAudioForTranscription } from "../api";

export default function VoiceInputButton({
  onTranscript,
  onDirectSend,
  onRecordingChange,
  disabled = false,
  onError,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimText, setInterimText] = useState("");

  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const timerRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mimeTypeRef = useRef("audio/webm");

  // Check Web Speech API support
  const SpeechRecognition =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, []);

  function stopAllMedia() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }

  function startAudioLevelMonitor(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 64;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (e) {
      console.warn("Audio level visualization unavailable:", e);
    }
  }

  async function handleStart() {
    if (disabled || isProcessing) return;
    setInterimText("");
    setRecordingDuration(0);
    audioChunksRef.current = [];

    // Request mic access first to test permissions
    let stream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support audio recording.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      startAudioLevelMonitor(stream);
    } catch (err) {
      let message = "Could not access microphone.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        message = "Microphone access was blocked. Please enable microphone permissions in your browser or continue typing.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        message = "No microphone was found on this device. Please continue using text input.";
      }
      onError?.(message);
      return;
    }

    // Determine supported mime type for MediaRecorder
    let chosenMime = "";
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        chosenMime = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        chosenMime = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        chosenMime = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        chosenMime = "audio/ogg";
      }
    }
    mimeTypeRef.current = chosenMime || "audio/webm";

    // 1. ALWAYS start MediaRecorder on the stream for guaranteed audio capture
    try {
      const options = chosenMime ? { mimeType: chosenMime } : undefined;
      const mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(200);
    } catch (recorderErr) {
      console.warn("MediaRecorder could not start:", recorderErr);
    }

    // 2. PARALLEL: Start Web Speech API recognition for live transcript preview if available
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        let finalAccumulated = "";

        recognition.onresult = (event) => {
          let currentInterim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalAccumulated += " " + transcript;
            } else {
              currentInterim += transcript;
            }
          }
          const combined = (finalAccumulated + " " + currentInterim).trim();
          setInterimText(combined);
        };

        recognition.onerror = (event) => {
          console.warn("Speech recognition warning/error:", event.error);
          if (event.error === "not-allowed") {
            onError?.("Microphone permission denied for speech recognition.");
          }
        };

        recognition.start();
      } catch (err) {
        console.warn("Web Speech API recognition start failed:", err);
      }
    }

    setIsRecording(true);
    onRecordingChange?.(true);

    timerRef.current = setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);
  }

  function deliverResult(text, sendDirectly) {
    if (!text) return;
    if (sendDirectly && onDirectSend) {
      onDirectSend(text);
    } else if (onTranscript) {
      onTranscript(text);
    }
  }

  async function handleStop(sendDirectly = false) {
    if (!isRecording) return;
    setIsRecording(false);
    onRecordingChange?.(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Capture whatever live text is available
    const liveText = interimText.trim();

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    // Always prefer server-side Whisper transcription for the final text.
    // Browser recognition is configured for English in many browsers and can
    // mis-transcribe Hindi or Hinglish. Whisper can detect multilingual speech
    // and code-switching from the recorded audio.
    if (recorder && recorder.state !== "inactive") {
      setIsProcessing(true);
      recorder.onstop = async () => {
        try {
          const mime = mimeTypeRef.current || "audio/webm";
          const audioBlob = new Blob(audioChunksRef.current, { type: mime });
          const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
          stopAllMedia();

          if (audioBlob.size > 500) {
            const result = await uploadAudioForTranscription(audioBlob, `speech.${ext}`);
            const textResult = result?.text?.trim() || "";
            if (textResult) {
              deliverResult(textResult, sendDirectly);
            } else if (liveText) {
              deliverResult(liveText, sendDirectly);
            } else {
              onError?.("No speech was detected. Please try speaking again or type your message.");
            }
          } else if (liveText) {
            deliverResult(liveText, sendDirectly);
          } else {
            onError?.("Audio recording was too short or quiet. Please speak into your microphone or type your message.");
          }
        } catch (err) {
          // Retain a browser transcript as a fallback if server transcription fails.
          if (liveText) {
            deliverResult(liveText, sendDirectly);
            onError?.("Multilingual transcription was unavailable; the browser transcript was used. Please check it before submitting.");
          } else {
            onError?.(err.message || "Failed to transcribe audio. Please type your message.");
          }
        } finally {
          stopAllMedia();
          setIsProcessing(false);
          audioChunksRef.current = [];
          setInterimText("");
        }
      };

      try {
        recorder.stop();
      } catch {
        stopAllMedia();
        setIsProcessing(false);
        if (liveText) deliverResult(liveText, sendDirectly);
        else onError?.("Could not process the recording. Please try again or type your message.");
      }
    } else {
      stopAllMedia();
      if (liveText) {
        deliverResult(liveText, sendDirectly);
      } else {
        onError?.("No speech was detected. Please try speaking again or type your message.");
      }
      setInterimText("");
    }
  }

  function handleCancel() {
    setIsRecording(false);
    onRecordingChange?.(false);
    setIsProcessing(false);
    setInterimText("");
    stopAllMedia();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
    }

    audioChunksRef.current = [];
  }

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (isRecording) {
    return (
      <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-1.5 bg-rose-50/90 border border-rose-200 rounded-xl shadow-xs">
        {/* Left: Recording status & audio wave */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-rose-700 text-xs font-semibold">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
            </span>
            <span>Recording ({formatTime(recordingDuration)})</span>
          </div>

          {/* Dynamic Audio Visualizer Bars */}
          <div className="flex items-center gap-0.5 h-4 px-1" title="Microphone activity">
            <div
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel * 16) / 100)}px` }}
            />
            <div
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel * 20) / 100)}px` }}
            />
            <div
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel * 14) / 100)}px` }}
            />
            <div
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel * 22) / 100)}px` }}
            />
            <div
              className="w-1 bg-rose-500 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, (audioLevel * 18) / 100)}px` }}
            />
          </div>
        </div>

        {/* Live speech preview if available */}
        {interimText && (
          <div className="flex-1 text-xs text-slate-700 bg-white/90 px-2.5 py-1 rounded-md border border-rose-200/60 truncate italic">
            &ldquo;{interimText}&rdquo;
          </div>
        )}

        {/* Action Buttons: Send Now, Insert Text, Cancel */}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {/* Send Now Button (Transcribes and sends directly to AI chat) */}
          <button
            type="button"
            onClick={() => handleStop(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 active:bg-teal-800 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Finish speaking and send directly to CareFlow AI"
            aria-label="Finish speaking and send message"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Now</span>
          </button>

          {/* Insert Text Button (Places transcript into text input for editing) */}
          <button
            type="button"
            onClick={() => handleStop(false)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors cursor-pointer"
            title="Insert transcript into text box to edit before sending"
            aria-label="Insert transcript into text box"
          >
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span>Insert</span>
          </button>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-0.5 px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
            title="Cancel and discard voice recording"
            aria-label="Cancel recording"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-teal-50/80 border border-teal-200 rounded-xl text-teal-800 text-xs font-medium shadow-xs">
        <Loader2 className="w-4 h-4 animate-spin text-teal-600 shrink-0" />
        <span>Transcribing your speech with AI…</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={disabled}
      className="inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-teal-700 hover:bg-teal-50 active:bg-teal-100 transition-colors border border-transparent hover:border-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      title="Click to speak your message with voice recognition"
      aria-label="Speak using microphone"
    >
      <Mic className="w-5 h-5" />
    </button>
  );
}
