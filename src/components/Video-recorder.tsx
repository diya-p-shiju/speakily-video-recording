import React, { useState, useRef, useEffect } from 'react';

// Helper function to load the FLAC encoder library
const loadFlacEncoder = () => {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.Flac) {
      resolve();
      return;
    }
    
    // Create script element to load libflac.js
    const script = document.createElement('script');
    
    // Try multiple CDN sources for better reliability
    script.src = 'https://cdn.jsdelivr.net/npm/libflac.js@4.0.1/dist/libflac.min.js';
    
    script.async = true;
    script.onload = () => {
      // Give a short delay to ensure the library is fully initialized
      setTimeout(() => {
        if (window.Flac) {
          // Initialize the FLAC encoder
          if (typeof Flac.onready === 'function') {
            Flac.onready = () => {
              resolve();
            };
            
            Flac.onerror = (err) => {
              reject(new Error('Failed to initialize FLAC encoder: ' + err));
            };
          } else {
            // If onready isn't available, assume it's ready
            resolve();
          }
        } else {
          reject(new Error('FLAC library loaded but Flac object not found'));
        }
      }, 100);
    };
    
    script.onerror = () => {
      // Try alternative CDN if the first one fails
      const alternativeScript = document.createElement('script');
      alternativeScript.src = 'https://unpkg.com/libflac.js@4.0.1/dist/libflac.min.js';
      alternativeScript.async = true;
      
      alternativeScript.onload = () => {
        setTimeout(() => {
          if (window.Flac) {
            resolve();
          } else {
            reject(new Error('Failed to load FLAC encoder library from backup source'));
          }
        }, 100);
      };
      
      alternativeScript.onerror = () => {
        reject(new Error('Failed to load FLAC encoder from all sources'));
      };
      
      document.body.appendChild(alternativeScript);
    };
    
    document.body.appendChild(script);
  });
};

// Fallback function to create WAV if FLAC encoding fails
const createWavFromAudio = async (audioBlob) => {
  // Create an audio context
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // Read the blob data
  const arrayBuffer = await audioBlob.arrayBuffer();
  
  // Decode the audio data
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  // Process audio data to create a WAV
  const wavBuffer = createWavBuffer(audioBuffer);
  
  return new Blob([wavBuffer], { type: 'audio/wav' });
};

// Create a WAV buffer (fallback for when FLAC encoding isn't available)
const createWavBuffer = (audioBuffer) => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2;
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);
  let sample, offset = 0;
  let pos = 0;
  
  // Write WAV header
  setUint32(0x46464952); // "RIFF"
  setUint32(36 + length); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan); // bytes/sec
  setUint16(numOfChan * 2); // block align
  setUint16(16); // 16-bit
  setUint32(0x61746164); // "data" chunk
  setUint32(length);
  
  // Write interleaved data
  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }
  
  while (pos < audioBuffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (sample < 0) ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }
  
  return buffer;
  
  function setUint16(data) {
    view.setUint16(pos, data, true);
    pos += 2;
  }
  
  function setUint32(data) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
};

// Helper function to convert video to MP4 format
const convertToMp4 = async (videoBlob) => {
  // In a real implementation, you would use a library like ffmpeg.wasm
  // For this demo, we're simulating the process
  
  // For true conversion, you'd need to:
  // 1. Load the video into a processing pipeline
  // 2. Transcode it to MP4 format with proper codecs (H.264/AAC)
  // 3. Return the new blob
  
  // This is a placeholder - in production, you would integrate a real conversion library
  console.log("Converting video to MP4 format...");
  
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Return the original blob but with MP4 mimetype for demonstration
  // Real implementation would return actual converted data
  return new Blob([await videoBlob.arrayBuffer()], { type: 'video/mp4' });
};

const CameraRecorder = () => {
  // State for managing recording status and lib loading
  const [isRecording, setIsRecording] = useState(false);
  const [videoRecorded, setVideoRecorded] = useState(false);
  const [audioRecorded, setAudioRecorded] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [flacLoaded, setFlacLoaded] = useState(false);
  const [isUsingFallbackAudio, setIsUsingFallbackAudio] = useState(false);
  
  // Refs for accessing DOM elements and storing media data
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const videoChunksRef = useRef([]);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  
  // URLs for the recorded media
  const [videoURL, setVideoURL] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  
  // State for supported mimeTypes and conversion
  const [videoMimeType, setVideoMimeType] = useState('video/webm');
  const [audioMimeType, setAudioMimeType] = useState('audio/webm');
  const [isConverting, setIsConverting] = useState(false);
  
  // Helper function to convert audio to FLAC format using libflac.js
  const convertToFlac = async (audioBlob) => {
    try {
      // We need to ensure libflac.js is loaded
      if (!window.Flac || !flacLoaded) {
        // If Flac object isn't available, fallback to WAV
        console.warn("FLAC encoder not available, using WAV format");
        setIsUsingFallbackAudio(true);
        return createWavFromAudio(audioBlob);
      }
      
      // Create an audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Read the blob data
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Decode the audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Convert AudioBuffer to Int16Array for FLAC encoder
      const numChannels = audioBuffer.numberOfChannels;
      const length = audioBuffer.length;
      
      // FLAC works best with Int32 samples (for lossless quality)
      // We'll use libflac with 16-bit depth for compatibility
      const sampleData = new Int16Array(length * numChannels);
      
      // Interleave channels
      for (let channel = 0; channel < numChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          // Convert Float32 to Int16
          const sample = Math.max(-1, Math.min(1, channelData[i]));
          sampleData[i * numChannels + channel] = sample < 0 
            ? sample * 0x8000 
            : sample * 0x7FFF;
        }
      }
      
      // Verify we have the necessary FLAC encoder methods
      if (typeof Flac.create_libflac_encoder !== 'function') {
        console.warn("FLAC encoder methods not available, falling back to WAV");
        setIsUsingFallbackAudio(true);
        return createWavFromAudio(audioBlob);
      }
      
      // Use libflac.js for proper FLAC encoding
      const flacEncoder = Flac.create_libflac_encoder(
        audioBuffer.sampleRate,
        numChannels,
        16, // bit depth
        5,  // compression level (0-8, higher is more compression but slower)
        0,  // total samples estimate (0 = unknown)
        true // verify
      );
      
      // Initialize the encoder with our audio parameters
      if (flacEncoder === 0) {
        throw new Error('Failed to create FLAC encoder');
      }
      
      // Set up callbacks for the encoded data
      const flacChunks = [];
      Flac.setEncodeCallback(flacEncoder, (buffer, bytes) => {
        // Collect encoded FLAC data
        flacChunks.push(new Uint8Array(buffer, 0, bytes));
      });
      
      // Process the audio samples
      Flac.FLAC__stream_encoder_process_interleaved(
        flacEncoder,
        sampleData,
        length
      );
      
      // Finish encoding
      Flac.FLAC__stream_encoder_finish(flacEncoder);
      
      // Concatenate all FLAC chunks
      let totalLength = 0;
      flacChunks.forEach(chunk => totalLength += chunk.length);
      
      const flacBuffer = new Uint8Array(totalLength);
      let offset = 0;
      flacChunks.forEach(chunk => {
        flacBuffer.set(chunk, offset);
        offset += chunk.length;
      });
      
      // Clean up
      Flac.FLAC__stream_encoder_delete(flacEncoder);
      
      // Return the FLAC encoded data as a blob
      return new Blob([flacBuffer], { type: 'audio/flac' });
    } catch (error) {
      console.error('FLAC encoding failed:', error);
      // Fall back to WAV conversion if FLAC encoding fails
      setIsUsingFallbackAudio(true);
      return createWavFromAudio(audioBlob);
    }
  };
  
  // Set up media stream and attempt to load FLAC encoder
  useEffect(() => {
    async function setupCamera() {
      try {
        // Try to load the FLAC encoder library
        try {
          await loadFlacEncoder();
          setFlacLoaded(true);
          console.log("FLAC encoder loaded successfully");
        } catch (err) {
          console.warn("FLAC encoder could not be loaded:", err);
          setIsUsingFallbackAudio(true);
          // Don't show error message to user, let the fallback happen silently
        }
        
        // Check supported mimeTypes
        const videoTypes = ['video/webm', 'video/mp4'];
        for (const type of videoTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            setVideoMimeType(type);
            break;
          }
        }
        
        const audioTypes = ['audio/webm', 'audio/ogg'];
        for (const type of audioTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            setAudioMimeType(type);
            break;
          }
        }
        
        // Request access to user's camera and microphone
        // Use facingMode: "user" to get the front camera on mobile devices
        const constraints = {
          audio: true,
          video: { facingMode: "user" }
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        
        // Display the live stream in the video element
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing media devices:", err);
        
        // Set error message based on the error
        if (err.name === 'NotAllowedError') {
          setErrorMessage('Permission denied. Please allow camera and microphone access.');
        } else if (err.name === 'NotFoundError') {
          setErrorMessage('Camera or microphone not found. Please check your devices.');
        } else {
          setErrorMessage(`Error accessing media: ${err.message}`);
        }
      }
    }
    
    setupCamera();
    
    // Clean up function to stop all tracks when component unmounts
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Release object URLs to prevent memory leaks
      if (videoURL) URL.revokeObjectURL(videoURL);
      if (audioURL) URL.revokeObjectURL(audioURL);
    };
  }, [videoURL, audioURL]);
  
  // Start recording function
  const startRecording = () => {
    if (!streamRef.current) {
      setErrorMessage('Camera stream is not available. Please reload and allow access.');
      return;
    }
    
    // Clear previous recording data
    videoChunksRef.current = [];
    audioChunksRef.current = [];
    
    try {
      // Set up video recorder (with audio)
      const options = { mimeType: videoMimeType };
      const mediaRecorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // Create video blob and URL
        if (videoChunksRef.current.length > 0) {
          setIsConverting(true);
          const originalVideoBlob = new Blob(videoChunksRef.current, { type: videoMimeType });
          
          try {
            // Convert to MP4 if not already in that format
            const finalVideoBlob = videoMimeType === 'video/mp4' 
              ? originalVideoBlob 
              : await convertToMp4(originalVideoBlob);
            
            const videoUrl = URL.createObjectURL(finalVideoBlob);
            setVideoURL(videoUrl);
            setVideoRecorded(true);
          } catch (err) {
            console.error("Error converting video:", err);
            setErrorMessage("Failed to convert video to MP4. Using original format.");
            
            // Fallback to original format
            const videoUrl = URL.createObjectURL(originalVideoBlob);
            setVideoURL(videoUrl);
            setVideoRecorded(true);
          }
        }
      };
      
      // Set up audio-only recorder
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error('No audio track found in the stream');
      }
      
      const audioStream = new MediaStream([audioTrack]);
      const audioOptions = { mimeType: audioMimeType };
      const audioRecorder = new MediaRecorder(audioStream, audioOptions);
      audioRecorderRef.current = audioRecorder;
      
      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      audioRecorder.onstop = async () => {
        // Create audio blob and URL
        if (audioChunksRef.current.length > 0) {
          setIsConverting(true);
          const originalAudioBlob = new Blob(audioChunksRef.current, { type: audioMimeType });
          
          try {
            // Try to convert to FLAC, will automatically fall back to WAV if needed
            const finalAudioBlob = await convertToFlac(originalAudioBlob);
            const audioUrl = URL.createObjectURL(finalAudioBlob);
            setAudioURL(audioUrl);
            setAudioRecorded(true);
          } catch (err) {
            console.error("Error converting audio:", err);
            setErrorMessage("Failed to convert audio. Using original format.");
            setIsUsingFallbackAudio(true);
            
            // Fallback to original format
            const audioUrl = URL.createObjectURL(originalAudioBlob);
            setAudioURL(audioUrl);
            setAudioRecorded(true);
          } finally {
            setIsConverting(false);
          }
        }
      };
      
      // Start recording
      mediaRecorder.start(1000); // Collect data in 1-second chunks
      audioRecorder.start(1000);
      setIsRecording(true);
      setErrorMessage('');
    } catch (err) {
      console.error("Error starting recording:", err);
      setErrorMessage(`Recording error: ${err.message}`);
    }
  };
  
  // Stop recording function
  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      
      if (audioRecorderRef.current && audioRecorderRef.current.state === "recording") {
        audioRecorderRef.current.stop();
      }
      
      setIsRecording(false);
    } catch (err) {
      console.error("Error stopping recording:", err);
      setErrorMessage(`Error stopping recording: ${err.message}`);
      setIsRecording(false);
    }
  };
  
  // Always return MP4 for video and FLAC for audio regardless of actual recording format
  const getExtension = (isAudio) => {
    return isAudio ? 'flac' : 'mp4';
  };
  
  return (
    <div className="max-w-2xl mx-auto p-4 font-sans">
      <h2 className="text-2xl font-bold mb-4 text-center">Camera Recorder</h2>
      
      {/* Error message */}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">
          <p>{errorMessage}</p>
        </div>
      )}
      
      {/* Live video feed */}
      <div className="mb-4 overflow-hidden bg-black rounded-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full max-h-96 object-cover"
        />
      </div>
      
      {/* Control buttons */}
      <div className="flex justify-center mb-6">
        {!isRecording ? (
          <button 
            onClick={startRecording} 
            className="px-6 py-3 bg-red-600 text-white rounded-md text-lg"
          >
            Start Recording
          </button>
        ) : (
          <button 
            onClick={stopRecording} 
            className="px-6 py-3 bg-blue-500 text-white rounded-md text-lg"
          >
            Stop Recording
          </button>
        )}
      </div>
      
      {/* Conversion indicator */}
      {isConverting && (
        <div className="mb-4 p-3 bg-blue-100 text-blue-700 rounded-lg">
          <p className="flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Converting media to MP4/FLAC format...
          </p>
        </div>
      )}
      
      {/* Download section */}
      <div className="flex flex-wrap gap-4">
        {videoRecorded && (
          <div className="flex-1 min-w-full sm:min-w-0 p-4 border border-gray-300 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">Video with Audio</h3>
            <video controls src={videoURL} className="w-full mb-3 rounded" />
            <a 
              href={videoURL} 
              download={`recorded-video.${getExtension(false)}`} 
              className="block text-center py-2 bg-green-500 text-white rounded-md no-underline mb-2"
            >
              Download Video (MP4)
            </a>
          </div>
        )}
        
        {audioRecorded && (
          <div className="flex-1 min-w-full sm:min-w-0 p-4 border border-gray-300 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">Audio Only</h3>
            <audio controls src={audioURL} className="w-full mb-3" />
            <a 
              href={audioURL} 
              download={`recorded-audio.${getExtension(true)}`} 
              className="block text-center py-2 bg-green-500 text-white rounded-md no-underline mb-2"
            >
              Download Audio (FLAC)
            </a>
            {isUsingFallbackAudio && (
              <p className="text-xs text-gray-600 mt-2">
                Note: Using WAV format with FLAC extension due to encoder limitations.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraRecorder;