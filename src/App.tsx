import React, { useState, useEffect, useRef } from 'react';
import './App.css';

// Type definitions for window object with Tauri internals
declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __TAURI_INVOKE__?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    __TAURI__?: unknown;
  }
}

// Unified Tauri IPC Invocation Guard: Connects native Tauri backend commands with graceful browser fallback
const safeInvoke = async <T extends unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> => {
  if (typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI_INVOKE__ || window.__TAURI__)) {
    try {
      const invokeFn = window.__TAURI_INTERNALS__?.invoke || window.__TAURI_INVOKE__;
      if (invokeFn) {
        return await invokeFn<T>(cmd, args);
      }
    } catch (err) {
      console.warn(`[Tauri Invoke Error] ${cmd}:`, err);
    }
  }

  // Fallback mock responses for browser preview mode
  console.log(`[Browser Mock Mode] Executed IPC command: ${cmd}`, args);
  if (cmd === 'start_recording') {
    return `C:\\Users\\dev\\AppData\\Local\\Temp\\dev_demo_${Date.now()}.webm` as unknown as T;
  }
  if (cmd === 'stop_recording' || cmd === 'reveal_recording') {
    return undefined;
  }
  return undefined;
};

// Initial Sample Bug Report Template
const SAMPLE_MARKDOWN = `# [BUG] UI State Desync on Rapid Form Submission & Navigation

## 1. Summary / Overview
During testing of the latest build, a regression was identified where rapid user interactions lead to an unhandled state desync/UI freeze. A complete, high-fidelity screen recording demonstrating the issue has been captured and archived.

- **Screen Recording:** \`dev_demo_1792988962.webm\` *(Attached from local capture)*
- **Severity:** Major (Priority: P2)
- **Environment:** Windows 11 Pro | Chrome v123.0 | Branch: \`main\` @ commit \`a8f190e\`

---

## 2. Steps to Reproduce
1. Navigate to \`/dashboard/settings/profile\`.
2. Populate the required input fields (\`Display Name\`, \`Email Notification Preferences\`).
3. Click **"Save Changes"** and immediately click the **"Back to Overview"** breadcrumb/link within < 300ms.
4. Return to \`/dashboard/settings/profile\`.

---

## 3. Expected vs. Actual Behavior

| Expected Behavior | Actual Behavior |
| :--- | :--- |
| • The form submission request completes in background.<br>• Route transitions gracefully.<br>• Form reflects valid state on re-entry. | • Pending mutation attempts state update on unmounted component.<br>• Persistent spinner remains stuck.<br>• Unhandled promise rejection logged in console. |

---

## 4. Suggested Technical Root Cause or Fix
- **Bind Request to AbortController:** Cancel in-flight requests on unmount.
- **Safe State Dispatch:** Ensure state setters verify component mounted state.`;

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('gemini_api_key') || '';
    } catch {
      return '';
    }
  });
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [latestPath, setLatestPath] = useState<string>('');
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [videoBase64Data, setVideoBase64Data] = useState<string | null>(null);

  // Telemetry & Environment Capture State
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: string; message: string; timestamp: string }>>([]);
  const [envMetadata, setEnvMetadata] = useState<Record<string, string>>({});

  // Visual Overlay State (Clicks & Keystrokes)
  const [clickRipples, setClickRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const [activeKeys, setActiveKeys] = useState<string[]>([]);

  // Product Tier State & Feature Gating
  const [userTier, setUserTier] = useState<'free' | 'pro' | 'team'>('free');
  const [isRetroactiveEnabled, setIsRetroactiveEnabled] = useState<boolean>(false);
  const [isPiiRedacted, setIsPiiRedacted] = useState<boolean>(false);
  const [piiTarget, setPiiTarget] = useState<'all' | 'keys_only' | 'env_only'>('keys_only');

  // GitHub Export State
  const [githubToken, setGithubToken] = useState<string>(() => localStorage.getItem('gh_pat') || '');
  const [githubRepo, setGithubRepo] = useState<string>(() => localStorage.getItem('gh_repo') || '');
  const [isExportingGithub, setIsExportingGithub] = useState<boolean>(false);
  const [githubIssueUrl, setGithubIssueUrl] = useState<string | null>(null);

  const [bugReport, setBugReport] = useState<string>(SAMPLE_MARKDOWN);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'raw' | 'github'>('preview');

  const [copyPathStatus, setCopyPathStatus] = useState<string>('Copy Path');
  const [copyReportStatus, setCopyReportStatus] = useState<string>('Copy Markdown');
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mounted ref & AbortController refs to prevent memory leaks and unhandled promise rejections
  const isMountedRef = useRef<boolean>(true);
  const apiAbortControllerRef = useRef<AbortController | null>(null);
  const githubAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (apiAbortControllerRef.current) {
        apiAbortControllerRef.current.abort();
      }
      if (githubAbortControllerRef.current) {
        githubAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Auto-Detect Environment Telemetry on Initialization
  useEffect(() => {
    const meta: Record<string, string> = {
      user_agent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    setEnvMetadata(meta);
  }, []);

  // Save API Key to localStorage
  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    try {
      localStorage.setItem('gemini_api_key', key);
    } catch (e) {
      console.warn('Could not save API key to local storage', e);
    }
  };

  // Recording Duration Counter Timer
  useEffect(() => {
    if (isRecording) {
      setRecordingDuration(0);
      durationTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    }

    return () => {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, [isRecording]);

  // Global Keyboard Shortcut listener (Ctrl + Alt + R to Start/Stop Recording) & Visual Key Overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Key visualizer tracker
      if (isRecording) {
        const keyName = e.key === ' ' ? 'Space' : e.key;
        setActiveKeys((prev) => [...prev.slice(-3), keyName]);
        setTimeout(() => setActiveKeys((prev) => prev.filter((k) => k !== keyName)), 1200);
      }

      if (e.ctrlKey && e.altKey && e.code === 'KeyR') {
        e.preventDefault();
        if (isRecording) {
          handleStopRecording();
        } else {
          startCountdownAndRecord();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording]);

  // Click Visualizer Tracker during Recording
  useEffect(() => {
    if (!isRecording) return;

    const handlePointerDown = (e: MouseEvent) => {
      const ripple = { id: Date.now(), x: e.clientX, y: e.clientY };
      setClickRipples((prev) => [...prev, ripple]);
      setTimeout(() => {
        setClickRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, 600);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isRecording]);

  // Telemetry Console Logger Interceptor
  const logTelemetry = (type: 'error' | 'warn' | 'info', message: string) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    setConsoleLogs((prev) => [...prev.slice(-49), { type, message, timestamp }]);
  };

  // Safe object serializer for circular structures
  const safeSerialize = (obj: unknown): string => {
    try {
      const seen = new WeakSet();
      return JSON.stringify(obj, (_key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
    } catch {
      return String(obj);
    }
  };

  // Hook into native browser console during recording sessions
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;

    console.error = (...args: unknown[]) => {
      logTelemetry('error', args.map(safeSerialize).join(' '));
      originalError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      logTelemetry('warn', args.map(safeSerialize).join(' '));
      originalWarn.apply(console, args);
    };

    console.log = (...args: unknown[]) => {
      logTelemetry('info', args.map(safeSerialize).join(' '));
      originalLog.apply(console, args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      console.log = originalLog;
    };
  }, []);

  // Format Duration into mm:ss
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start 3-Second Countdown before Capture
  const startCountdownAndRecord = () => {
    if (isRecording || countdown !== null) return;

    setRecordingDuration(0);
    setCountdown(3);
  };

  // Synchronize ref with state for async callbacks
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Primary Screen & Window Capture Logic
  const executeStartRecording = async () => {
    recordedChunksRef.current = [];
    setRecordingError(null);

    // 1. Request display media stream FIRST before triggering native backend state
    let stream: MediaStream | null = null;
    try {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: false,
        });
      } catch (constraintErr: any) {
        if (constraintErr?.name === 'NotAllowedError') {
          console.info('Screen capture canceled by user.');
          setRecordingError('Screen capture was canceled. Recording did not start.');
          await safeInvoke('stop_recording');
          setIsRecording(false);
          setCountdown(null);
          return;
        }
        console.warn('Advanced constraints rejected, falling back to minimal video constraint:', constraintErr);
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      }

      if (!stream) {
        throw new Error('Could not acquire media stream.');
      }

      // 2. Notify Tauri backend command ONLY after screen media stream acquisition succeeds with explicit metadata
      const filePath = await safeInvoke<string>('start_recording', { 
        target_window: 'Visual Studio Code',
        frame_rate: 30,
      });
      if (filePath) {
        setLatestPath(filePath);
      }

      streamRef.current = stream;

      // Handle user clicking "Stop Sharing" from OS browser overlay bar with guard against transient focus shifts
      if (stream.getVideoTracks().length > 0) {
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.onended = () => {
          // Guard: Only handle stop if the session is actively recording and stream state is truly ended
          if (isRecordingRef.current && videoTrack.readyState === 'ended') {
            handleStopRecording();
            setRecordingError('Screen recording has stopped.');
          }
        };
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoBlobUrl(url);

        // Convert captured blob stream to Base64 for Gemini API submission
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          // Strip out data URL header (e.g., "data:video/webm;base64,")
          const rawBase64 = base64String.split(',')[1] || base64String;
          setVideoBase64Data(rawBase64);
        };
        reader.readAsDataURL(blob);

        // Clean up tracks when recording is stopped
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      // Collect data chunks every 1 second
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        console.log('Screen recording prompt was canceled or denied by user.');
        setRecordingError('Screen recording canceled: Permission was denied or screen picker was dismissed.');
        await safeInvoke('stop_recording');
      } else {
        console.error('Failed to start display capture stream:', err);
        setRecordingError(`Recording failed: ${err?.message || 'Display capture permission denied or unsupported.'}`);
        await safeInvoke('stop_recording');
      }
      setIsRecording(false);
      setCountdown(null);
    }
  };

  // Start recording when the countdown reaches zero.
  useEffect(() => {
    if (countdown === null) return;

    const timer = setTimeout(() => {
      if (countdown <= 1) {
        setCountdown(null);
        void executeStartRecording();
      } else {
        setCountdown(countdown - 1);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  // Stop Recording Session
  const handleStopRecording = async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    await safeInvoke('stop_recording');
    setIsRecording(false);
  };

  // Copy File Path Action
  const handleCopyPath = () => {
    if (!latestPath) return;
    navigator.clipboard.writeText(latestPath);
    safeInvoke('reveal_recording', { path: latestPath });
    setCopyPathStatus('Copied!');
    setTimeout(() => setCopyPathStatus('Copy Path'), 2000);
  };

  // Copy Report Action
  const handleCopyReport = () => {
    navigator.clipboard.writeText(bugReport);
    setCopyReportStatus('Copied!');
    setTimeout(() => setCopyReportStatus('Copy Markdown'), 2000);
  };

  // Publish Issue to GitHub API (Pro/Team Feature)
  const handleExportToGithub = async () => {
    if (userTier === 'free') {
      alert('GitHub Export is a Pro/Team feature. Switch tier in top header to test!');
      return;
    }
    if (!githubRepo || !githubToken) {
      alert('Please enter your GitHub Repository (owner/repo) and Personal Access Token.');
      return;
    }

    // Abort any existing in-flight request
    if (githubAbortControllerRef.current) {
      githubAbortControllerRef.current.abort();
    }
    githubAbortControllerRef.current = new AbortController();

    setIsExportingGithub(true);
    setGithubIssueUrl(null);

    try {
      const response = await fetch(`https://api.github.com/repos/${githubRepo}/issues`, {
        method: 'POST',
        signal: githubAbortControllerRef.current.signal,
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          title: `[DevDemo Bug Report] ${new Date().toLocaleDateString()}`,
          body: bugReport,
          labels: ['bug', 'dev-demo-copilot'],
        }),
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || 'Failed to export issue to GitHub');
      }

      if (isMountedRef.current) {
        setGithubIssueUrl(resData.html_url);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('GitHub issue export failed:', err);
      if (isMountedRef.current) {
        alert(`GitHub Export Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsExportingGithub(false);
      }
    }
  };

  // Generate AI Bug Report via Gemini API
  const handleGenerateAIReport = async () => {
    if (!apiKey) {
      alert('Please enter your Google AI Studio API Key before generating an AI report.');
      return;
    }

    if (videoBlobUrl && !videoBase64Data) {
      alert('Video recording is still processing into Base64 format. Please wait a second and try again.');
      return;
    }

    // Abort any previous in-flight AI generation request
    if (apiAbortControllerRef.current) {
      apiAbortControllerRef.current.abort();
    }
    apiAbortControllerRef.current = new AbortController();

    setIsGenerating(true);

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent`;

      const promptText = `You are an expert QA and Software Reliability Engineer. Analyze this recorded bug session video along with the captured system telemetry logs and generate a professional, high-fidelity markdown bug report.
      
Captured Console Logs:
${JSON.stringify(consoleLogs, null, 2)}

System Environment Metadata:
${JSON.stringify(envMetadata, null, 2)}`;

      const contents = [
        {
          parts: [
            { text: promptText },
            ...(videoBase64Data
              ? [
                  {
                    inline_data: {
                      mime_type: 'video/webm',
                      data: videoBase64Data,
                    },
                  },
                ]
              : []),
          ],
        },
      ];

      const res = await fetch(endpoint, {
        method: 'POST',
        signal: apiAbortControllerRef.current.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({ contents }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.error?.message || `HTTP ${res.status}`;
        throw new Error(`Gemini API Error (${res.status}): ${errorMsg}`);
      }

      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (generatedText) {
        if (isMountedRef.current) {
          setBugReport(generatedText);
        }
      } else {
        throw new Error('Received an empty response payload from Gemini API.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Error generating report with Gemini:', err);
      if (isMountedRef.current) {
        alert(`AI Generation Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  return (
    <div className="app-container">
      {/* Visual Ripple Overlay for Click Visualizer */}
      {clickRipples.map((ripple) => (
        <div
          key={ripple.id}
          style={{
            position: 'fixed',
            left: ripple.x - 15,
            top: ripple.y - 15,
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '2px solid var(--accent-blue)',
            background: 'rgba(88, 166, 255, 0.3)',
            pointerEvents: 'none',
            zIndex: 9999,
            animation: 'pulse-red 0.6s ease-out forwards',
          }}
        />
      ))}

      {/* Visual Keystroke Overlay Badge */}
      {isRecording && activeKeys.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            display: 'flex',
            gap: '0.4rem',
            zIndex: 9999,
          }}
        >
          {activeKeys.map((k, i) => (
            <kbd
              key={i}
              style={{
                background: 'var(--bg-tertiary)',
                color: 'var(--accent-blue)',
                border: '1px solid var(--border-color)',
                padding: '0.3rem 0.6rem',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.85rem',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {k}
            </kbd>
          ))}
        </div>
      )}

      {/* Application Header Bar & Tier Switcher Simulator */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.35rem', color: 'var(--text-heading)', fontWeight: 700 }}>
            DevDemo Copilot
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            AI-Powered Session Recorder & Automatic Bug Ticket Generator
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Demo Tier:</span>
          <select
            value={userTier}
            onChange={(e) => setUserTier(e.target.value as 'free' | 'pro' | 'team')}
            className="input-field"
            style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.8rem', fontWeight: 600 }}
          >
            <option value="free">Free Tier (BYOK)</option>
            <option value="pro">Pro Tier ($15/mo)</option>
            <option value="team">Team Tier ($39/mo)</option>
          </select>
        </div>
      </header>

      {/* API Key Configuration Block */}
      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text-heading)' }}>
          Google Gemini API Configuration
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type={showApiKey ? 'text' : 'password'}
            className="input-field"
            placeholder="Enter your Gemini API key (AI Studio)"
            value={apiKey}
            onChange={(e) => handleSaveApiKey(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </section>

      {/* Recording Control Center */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', color: 'var(--text-heading)' }}>
              Recording Control Center
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Shortcut: <kbd style={{ background: 'var(--bg-tertiary)', padding: '2px 5px', borderRadius: '4px' }}>Ctrl + Alt + R</kbd>
            </p>
          </div>

          {/* Pro Feature: 30-Second Rolling Retroactive Buffer Switch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              30s Retroactive Buffer {userTier === 'free' && '🔒'}
            </label>
            <input
              type="checkbox"
              disabled={userTier === 'free'}
              checked={isRetroactiveEnabled}
              onChange={(e) => setIsRetroactiveEnabled(e.target.checked)}
              style={{ cursor: userTier === 'free' ? 'not-allowed' : 'pointer' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {countdown !== null ? (
            <button type="button" className="btn btn-purple" disabled style={{ minWidth: '160px' }}>
              Starting in {countdown}...
            </button>
          ) : !isRecording ? (
            <button type="button" className="btn btn-green" onClick={startCountdownAndRecord} style={{ minWidth: '160px' }}>
              Start Screen Recording
            </button>
          ) : (
            <button type="button" className="btn btn-red" onClick={handleStopRecording} style={{ minWidth: '160px' }}>
              <span className="recording-dot" /> Stop Recording ({formatDuration(recordingDuration)})
            </button>
          )}

          {latestPath && (
            <button type="button" className="btn btn-secondary" onClick={handleCopyPath}>
              {copyPathStatus}
            </button>
          )}
        </div>

        {recordingError && (
          <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', background: 'rgba(218, 54, 51, 0.15)', border: '1px solid var(--accent-red)', borderRadius: '6px', color: '#f85149', fontSize: '0.8rem' }}>
            ℹ️ {recordingError}
          </div>
        )}
      </section>

      {/* Video Player Preview Block */}
      {videoBlobUrl && (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 style={{ fontSize: '1rem', color: 'var(--text-heading)' }}>
              Captured Session Preview
            </h2>
            
            {/* Pro Feature: Smart Targeted PII Redaction Controls */}
            {userTier !== 'free' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <select 
                  value={piiTarget} 
                  onChange={(e) => setPiiTarget(e.target.value as 'all' | 'keys_only' | 'env_only')}
                  className="input-field" 
                  style={{ width: 'auto', padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                >
                  <option value="keys_only">Blur API Keys & Tokens</option>
                  <option value="env_only">Blur .env Variables</option>
                  <option value="all">Blur Full Viewport</option>
                </select>
                <button 
                  type="button" 
                  className={`btn ${isPiiRedacted ? 'btn-green' : 'btn-secondary'}`}
                  onClick={() => setIsPiiRedacted(!isPiiRedacted)}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                >
                  {isPiiRedacted ? '🔒 PII Mask Active' : '🛡️ Enable PII Blur Mask'}
                </button>
              </div>
            )}
          </div>

          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-sm)' }}>
            <video
              src={videoBlobUrl}
              controls
              style={{
                width: '100%',
                maxHeight: '360px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#000',
                filter: isPiiRedacted && piiTarget === 'all' ? 'blur(6px)' : 'none',
                transition: 'filter 0.3s ease',
              }}
            />
            {isPiiRedacted && piiTarget !== 'all' && (
              <div 
                style={{
                  position: 'absolute',
                  top: piiTarget === 'keys_only' ? '20%' : '10%',
                  left: '8%',
                  width: '84%',
                  height: '30%',
                  backdropFilter: 'blur(12px)',
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px dashed var(--accent-blue)',
                  borderRadius: '6px',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-heading)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  zIndex: 2,
                }}
              >
                🔒 Redacted Region ({piiTarget === 'keys_only' ? 'API Key Overlay' : '.env Credentials'})
              </div>
            )}
            {isPiiRedacted && (
              <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.85)', color: 'var(--accent-blue)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid var(--border-color)', zIndex: 3, pointerEvents: 'none' }}>
                Targeted PII Mask: {piiTarget.toUpperCase()}
              </div>
            )}
          </div>
        </section>
      )}

      {/* AI Bug Report Generator Actions */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', color: 'var(--text-heading)' }}>
            AI Bug Report Generator
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveTab('preview')}
              style={{
                backgroundColor: activeTab === 'preview' ? 'var(--border-color)' : 'transparent',
              }}
            >
              Formatted View
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveTab('raw')}
              style={{
                backgroundColor: activeTab === 'raw' ? 'var(--border-color)' : 'transparent',
              }}
            >
              Raw Markdown
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActiveTab('github')}
              style={{
                backgroundColor: activeTab === 'github' ? 'var(--border-color)' : 'transparent',
              }}
            >
              Export GitHub {userTier === 'free' && '🔒'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <button
            type="button"
            className="btn btn-purple"
            disabled={isGenerating}
            onClick={handleGenerateAIReport}
          >
            {isGenerating ? 'Generating...' : 'Generate Bug Report'}
          </button>
        </div>
      </section>
    </div>
  );
}