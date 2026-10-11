/**
 * No mocked prices, transactions, attestation, mint or success indicators.
 * Production bridge/FX capabilities require a separately hosted BFF,
 * Circle credentials, database migrations and wallet-signed acceptance.
 */
import { ArrowRight, ExternalLink, LockKeyhole, Route, ShieldAlert } from 'lucide-react';
import type { PreviewPage } from './PreviewApp';

export function PreviewServiceStatus({
  surface, onNavigate,
}: {
  surface: 'convert' | 'bridge';
  onNavigate: (page: PreviewPage) => void;
}) {
  const bridge = surface === 'bridge';
  return (
    <div className="vp-page" style={{ maxWidth: 950 }}>
      <div className="vp-page-heading">
        <div>
          <p className="vp-eyebrow">VEYRA TESTNET BETA · SERVICE GATE</p>
          <h1 className="vp-page-title">{bridge ? 'Bridge USDC' : 'Convert assets'}</h1>
          <p className="vp-page-description">
            {bridge
              ? 'Chuyển USDC xuyên chain thật cần Circle attestation, mint proof và trạng thái retry bền vững.'
              : 'Đổi tài sản thật cần báo giá còn hạn, kiểm tra slippage và bộ xác minh giao dịch.'}
          </p>
        </div>
        <span className="vp-chain-pill"><LockKeyhole size={15} /> Chưa được nghiệm thu</span>
      </div>
      <div className="vp-card vp-card-pad" style={{ borderColor: 'rgba(232,182,98,.25)' }}>
        <div className="vp-balance-head" style={{ marginBottom: 18 }}>
          <span className="vp-quick-icon" style={{ color: '#e8b98d', background: '#403128' }}>
            {bridge ? <Route size={22} /> : <ShieldAlert size={22} />}
          </span>
          <div>
            <strong className="vp-card-title" style={{ fontSize: 17 }}>
              Chưa có dịch vụ giao dịch thật trên Vercel
            </strong>
            <p className="vp-caption">
              Không hiển thị báo giá, mô phỏng thành công hoặc nút ký giả.
            </p>
          </div>
        </div>
        <p className="vp-caption">
          Code Express BFF đã có trong repository, nhưng Preview Vite hiện không tự
          triển khai PostgreSQL hoặc kết nối Circle và dịch vụ xác thực. Bật giao dịch
          khi chưa có những thành phần đó có thể tạo tiền bị kẹt hoặc báo thành công sai.
        </p>
        <div className="vp-stack" style={{ marginTop: 20, gap: 12 }}>
          {(bridge
            ? [
                'Triển khai HTTPS BFF và PostgreSQL; chạy migration và kiểm tra auth.',
                'Nghiệm thu nguồn Arc → Circle attestation → mint đích bằng ví testnet.',
                'Xác nhận chống burn trùng, retry không chắc chắn và ActivityReceipt.',
              ]
            : [
                'Kết nối nhà cung cấp báo giá FX thực qua BFF.',
                'Xác minh expiry, phí, slippage và policy ở phía server.',
                'Đối chiếu transaction receipt on-chain và lỗi thanh khoản.',
              ]
          ).map((item, i) => (
            <div className="vp-step" key={item}>
              <span className="vp-step-number">{i + 1}</span>
              <strong style={{ fontSize: 12 }}>{item}</strong>
            </div>
          ))}
        </div>
        <div className="vp-form-note" style={{ marginTop: 20 }}>
          <LockKeyhole size={18} style={{ flex: 'none' }} />
          <span>
            Đây là tính năng bị khóa vì chưa đủ bằng chứng triển khai thực tế.
            Không có request ký hay chuyển tài sản nào được tạo trên màn này.
          </span>
        </div>
        <div className="vp-hero-buttons">
          <button type="button" className="vp-primary" onClick={() => onNavigate('pay')}>
            Mở Pay Arc Testnet thật <ArrowRight size={15} />
          </button>
          <a href="https://github.com/bearbaba/Veyra/pull/7"
            target="_blank" rel="noopener noreferrer" className="vp-secondary">
            Theo dõi triển khai Bridge/FX <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
