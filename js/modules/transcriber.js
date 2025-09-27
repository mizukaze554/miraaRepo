// Transcription functionality using Transformers.js
export async function loadTranscriber(modelId, setStatus) {
  setStatus(`Loading model ${modelId} (may be large) — this downloads to your browser...`, 50);
  const { pipeline } = window.transformers;
  const transcriber = await pipeline('automatic-speech-recognition', modelId);
  setStatus("Model loaded.", 70);
  return transcriber;
}

export async function transcribeAudioBlob(transcriber, audioBlob, langOption, setStatus) {
  setStatus("Preparing audio for transcription...", 72);
  const file = new File([audioBlob], "audio.wav", { type: "audio/wav" });

  setStatus("Transcribing (this may take time)...", 75);
  const result = await transcriber(file);
  const text = result?.text ?? (typeof result === 'string' ? result : JSON.stringify(result));
  setStatus("Transcription finished.", 95);
  return text;
}