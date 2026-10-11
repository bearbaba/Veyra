/**
 * Genuine server-backed AI agent. No offline canned responses.
 * Vercel Function GET/POST /api/agent/chat is separate from the live BFF.
 * No secrets are compiled into this browser: beta access token lives in
 * component memory and disappears on refresh.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, ExternalLink, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react';
import type { PreviewPage } from './PreviewApp';

type ChatMessage = { role: 'user' | 'assistant'; text: string };
type Status = { live: boolean; provider: string | null };
const EXAMPLES = [
  'Tôi muốn gửi USDC trên Arc Testnet thì làm sao?',
  'Circle CCTP V2 khác chuyển USDC thông thường ở đâu?',
  'Nếu ví không trả về tx hash thì xử lý thế nào?',
];

export function PreviewLiveAgent({ onNavigate }: { onNavigate: (page: PreviewPage) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setStatus(null);
    setStatusError(null);
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('AI endpoint is not deployed.');
      const data = await response.json() as {
        ok?: unknown; live?: unknown; provider?: unknown;
      };
      if (data.ok !== true || typeof data.live !== 'boolean') {
        throw new Error('AI endpoint returned invalid status.');
      }
      setStatus({
        live: data.live,
        provider: typeof data.provider === 'string' ? data.provider : null,
      });
    } catch {
      setStatusError('Máy chủ AI chưa được triển khai hoặc không truy cập được. Không có câu trả lời giả lập.');
    }
  }, []);

  useEffect(() => { void checkStatus(); }, [checkStatus]);

  async function sendMessage(event?: FormEvent<HTMLFormElement>, example?: string) {
    event?.preventDefault();
    const question = (example ?? input).trim();
    if (busy || !status?.live || accessCode.trim().length < 24 ||
        !question || question.length > 1200) return;

    setBusy(true);
    setError(null);
    const prior = messages.slice(-6);
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessCode.trim()}`,
        },
        body: JSON.stringify({ message: question, history: prior }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean; live?: boolean; reply?: unknown; error?: string;
      };
      if (!response.ok || payload.ok !== true || payload.live !== true ||
          typeof payload.reply !== 'string' || !payload.reply.trim()) {
        throw new Error(response.status === 401
          ? 'Mã truy cập beta không đúng. Kiểm tra VEYRA_AGENT_BETA_TOKEN trên Vercel.'
          : response.status === 503
            ? 'API AI thật chưa sẵn sàng. Kiểm tra OPENAI_API_KEY và biến môi trường Vercel.'
            : 'API AI không trả về câu trả lời hợp lệ. Không sử dụng fallback giả lập.');
      }
      setMessages([...prior, { role: 'user', text: question },
        { role: 'assistant', text: payload.reply }]);
      setInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể kết nối tới AI thật.');
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.live === true;
  return (
    <div className="vp-page" style={{ maxWidth: 890 }}>
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">VEYRA INTELLIGENCE · LIVE SERVER AI</p>
          <h1 className="vp-page-title">Hỏi Veyra <Sparkles size={23} style={{ display: 'inline', color: '#c5fb71' }} /></h1>
          <p className="vp-page-description">Trò chuyện với mô hình AI thật qua API được bảo vệ trên máy chủ. Không có câu trả lời viết sẵn.</p>
        </div>
        <span className="vp-chain-pill">
          {ready ? <Wifi size={14} color="#b6f08c" /> : <WifiOff size={14} />}
          {ready ? 'AI endpoint online' : status ? 'Chưa cấu hình AI' : 'Đang kiểm tra AI'}
        </span>
      </div>

      <div className="vp-card vp-card-pad">
        <div className="vp-balance-head" style={{ marginBottom: 20 }}>
          <span className="vp-quick-icon"><Bot size={21} /></span>
          <div style={{ flex: 1 }}>
            <strong className="vp-card-title">Veyra Assistant</strong>
            <p className="vp-caption">{ready ? 'OpenAI · phản hồi qua Vercel Function thật' : 'AI thật cần API key máy chủ và mã beta riêng'}</p>
          </div>
          <button className="vp-icon-button" type="button" onClick={() => void checkStatus()}
            aria-label="Kiểm tra lại trạng thái AI"><RefreshCw size={16} /></button>
        </div>

        {!ready && (
          <div className="vp-form-note" role="status" style={{ marginBottom: 18 }}>
            <WifiOff size={19} style={{ flex: 'none' }} />
            <div>
              <strong>{statusError ?? 'Chưa bật API AI thật trên Vercel.'}</strong>
              <p style={{ marginTop: 8 }}>
                Trong Vercel → Project → Settings → Environment Variables, tạo
                <code> OPENAI_API_KEY</code>, <code>VEYRA_AGENT_BETA_TOKEN</code> (tối thiểu 24 ký tự)
                và <code>VEYRA_AGENT_ENABLED=1</code> cho Preview, rồi redeploy.
                Không nhập API key OpenAI vào website hoặc biến VITE_*.
              </p>
              <a href="https://vercel.com/docs/environment-variables" target="_blank" rel="noreferrer"
                className="vp-text-button" style={{ display: 'inline-flex', gap: 5, marginTop: 8 }}>
                Hướng dẫn Vercel Environment Variables <ExternalLink size={13}/>
              </a>
            </div>
          </div>
        )}

        {ready && (
          <div style={{ marginBottom: 19 }}>
            <label className="vp-form-label" htmlFor="vp-agent-beta-code">
              <KeyRound size={14} style={{ display: 'inline', marginRight: 6 }}/>
              Mã truy cập riêng (VEYRA_AGENT_BETA_TOKEN)
            </label>
            <input id="vp-agent-beta-code" className="vp-form-input"
              type="password" autoComplete="off" spellCheck={false} value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="Nhập mã beta bạn đã đặt trong Vercel" maxLength={160}/>
            <p className="vp-caption" style={{ marginTop: 7 }}>
              Mã chỉ giữ trong phiên trang này; không lưu vào localStorage. Không gửi private key hay seed phrase.
            </p>
          </div>
        )}

        <div className="vp-agent-conversation" aria-live="polite" style={{ minHeight: 275 }}>
          {messages.length === 0 ? (
            <div className="vp-empty-state" style={{ paddingTop: 38 }}>
              {ready ? <Sparkles size={32} color="#c5fb71" /> : <LockKeyhole size={32} color="#a7acc7" />}
              <h3>{ready ? 'Hỏi một câu thật — AI sẽ trả lời từ server.' : 'Chưa kết nối mô hình AI'}</h3>
              <p>{ready
                ? 'AI trả lời nội dung, nhưng không thể xem số dư riêng của bạn, ký ví hoặc tự chuyển USDC.'
                : 'Không có kịch bản dự phòng. Bật API AI trên Vercel trước khi trò chuyện.'}</p>
            </div>
          ) : (
            <div className="vp-stack">
              {messages.map((item, i) => (
                <div key={i}
                  className={item.role === 'assistant' ? 'vp-agent-bubble vp-agent-response' : 'vp-agent-bubble'}
                  style={item.role === 'user' ? { marginLeft: '14%', whiteSpace: 'pre-wrap' } : { whiteSpace: 'pre-wrap' }}>
                  {item.text}
                </div>
              ))}
            </div>
          )}
          {busy && <p className="vp-caption" style={{ marginTop: 15 }}>Đang gửi câu hỏi đến mô hình AI…</p>}
        </div>

        <div className="vp-agent-questions" style={{ marginBottom: 15 }}>
          {EXAMPLES.map((question) => (
            <button key={question} type="button" disabled={!ready || accessCode.trim().length < 24 || busy}
              onClick={() => void sendMessage(undefined, question)}>{question}</button>
          ))}
        </div>
        {error && <p className="vp-form-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
        <form onSubmit={(event) => void sendMessage(event)} style={{ display: 'flex', gap: 10 }}>
          <input className="vp-form-input" aria-label="Hỏi Veyra" maxLength={1200} autoComplete="off"
            placeholder={ready ? 'Hỏi AI thật về Arc, USDC, giao dịch…' : 'Chưa có backend AI'}
            disabled={!ready || busy} value={input} onChange={(event) => setInput(event.target.value)}/>
          <button className="vp-primary" type="submit"
            disabled={!ready || busy || accessCode.trim().length < 24 || !input.trim()}>
            <ArrowRight size={17}/>
          </button>
        </form>
      </div>

      <div className="vp-form-note" style={{ marginTop: 18 }}>
        <ShieldCheck size={18} style={{ flex: 'none' }}/>
        <p>
          AI thật chỉ trả lời văn bản. Gửi USDC testnet phải thực hiện trong <strong>Send & Pay</strong>,
          qua màn hình review riêng và chữ ký xác nhận của chính bạn. Convert/Bridge vẫn cần backend và nghiệm thu E2E.
        </p>
      </div>
      <button type="button" className="vp-text-button" style={{ marginTop: 18 }}
        onClick={() => onNavigate('pay')}>Mở thanh toán Arc Testnet <ArrowRight size={15} style={{ display: 'inline' }}/></button>
    </div>
  );
}
