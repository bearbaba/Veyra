import { validateIntentResponse, type IntentResult } from '../intent/intentSchema';

export type AgentMode = 'CHAT' | 'ACTION' | 'CLARIFICATION';
export type AgentServiceMode = 'ONLINE' | 'FALLBACK';
export type AgentExecutionMode = 'AVAILABLE' | 'LOCKED';

export interface AgentHistoryMessage {
  role: 'user' | 'agent';
  text: string;
}

export interface AgentCapabilities {
  conversation: AgentServiceMode;
  planning: AgentServiceMode;
  execution: AgentExecutionMode;
  provider: string;
}

export interface AgentChatResponse {
  ok: true;
  reply: string;
  locale: string;
  mode: AgentMode;
  intent?: IntentResult;
  degraded: boolean;
  capabilities: AgentCapabilities;
}

const TOKEN_SYMBOLS = ['USDC', 'EURC', 'CIRBTC', 'USYC', 'ETH', 'WETH', 'WBTC', 'USDT', 'DAI'] as const;

const CHAIN_ALIASES: Array<{ canonical: string; aliases: RegExp[] }> = [
  { canonical: 'Arc', aliases: [/\barc\b/i, /arc testnet/i] },
  { canonical: 'Base', aliases: [/\bbase\b/i] },
  { canonical: 'Ethereum', aliases: [/\beth(?:ereum)?\b/i] },
  { canonical: 'Arbitrum', aliases: [/\barbitrum\b/i, /\barb\b/i] },
  { canonical: 'Optimism', aliases: [/\boptimism\b/i, /\bop mainnet\b/i] },
  { canonical: 'Avalanche', aliases: [/\bavalanche\b/i, /\bavax\b/i] },
  { canonical: 'Polygon', aliases: [/\bpolygon\b/i, /\bpol\b/i] },
  { canonical: 'Solana', aliases: [/\bsolana\b/i] },
];

const TRANSFER_HINTS = [
  /\bsend\b/i, /\bpay\b/i, /\btransfer\b/i,
  /\bgửi\b/i, /\bchuyển\b/i,
  /\benv[ií]a\b/i, /\benviar\b/i,
  /\benvoie\b/i, /\benvoyer\b/i,
  /\bsende\b/i, /\bsenden\b/i,
  /\benvie\b/i, /\benviar\b/i,
  /\bkirim\b/i, /\bgönder\b/i,
  /送(?:る|って|信)?/u, /发送/u, /轉帳|转账/u, /보내/u,
  /ส่ง/u, /أرسل/u, /ارسال/u, /भेज/u,
];

const CONVERT_HINTS = [
  /\bconvert\b/i, /\bswap\b/i, /\bexchange\b/i,
  /\bđổi\b/i, /\bhoán đổi\b/i,
  /\bcambiar\b/i, /\bconvertir\b/i,
  /\béchanger\b/i, /\bwechseln\b/i,
  /\btukar\b/i, /交換/u, /兑换|兌換/u, /교환/u, /แลก/u, /تبديل/u, /बदल/u,
];

const BRIDGE_HINTS = [
  /\bbridge\b/i, /cross[- ]?chain/i, /\bmove.*chain\b/i,
  /chuyển.*(?:chain|mạng)/i, /qua (?:chain|mạng)/i,
  /puente/i, /intercadena/i, /跨链|跨鏈/u, /ブリッジ/u, /브리지/u,
];

function hasAny(input: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(input));
}

function sanitizeText(value: unknown, max = 800): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function extractAmount(message: string): string | undefined {
  const match = message.match(/(?:^|\s)(\d{1,18}(?:[.,]\d{1,8})?)(?=\s|$|\p{L}|\p{S})/u);
  return match?.[1];
}

function extractTokens(message: string): string[] {
  const upper = message.toUpperCase();
  return TOKEN_SYMBOLS.filter((symbol) => upper.includes(symbol));
}

function extractRecipient(message: string): string | undefined {
  const address = message.match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (address) return address;
  const handle = message.match(/@[A-Za-z0-9_.-]{2,64}/)?.[0];
  return handle;
}

function extractChains(message: string): string[] {
  const found: string[] = [];
  for (const chain of CHAIN_ALIASES) {
    if (chain.aliases.some((alias) => alias.test(message))) found.push(chain.canonical);
  }
  return Array.from(new Set(found));
}

function localized(locale: string, key: keyof typeof COPY.en): string {
  const lang = locale.toLowerCase();
  const copy =
    lang.startsWith('vi') ? COPY.vi :
    lang.startsWith('ja') ? COPY.ja :
    lang.startsWith('ko') ? COPY.ko :
    lang.startsWith('zh') ? COPY.zh :
    lang.startsWith('es') ? COPY.es :
    lang.startsWith('fr') ? COPY.fr :
    lang.startsWith('de') ? COPY.de :
    lang.startsWith('pt') ? COPY.pt :
    lang.startsWith('id') ? COPY.id :
    lang.startsWith('th') ? COPY.th :
    lang.startsWith('ar') ? COPY.ar :
    lang.startsWith('hi') ? COPY.hi :
    COPY.en;
  return copy[key] ?? COPY.en[key];
}

const COPY = {
  en: {
    hello: 'Hi — I’m Veyra. Tell me what you want to do with your money, in any language. I can explain Veyra, prepare payments, and build actions for your review.',
    help: 'I can help you pay a Veyra ID, X handle, or wallet; prepare conversions and cross-chain routes; explain what Veyra is doing; and turn natural language into a reviewable action. I never sign for you.',
    fallback: 'I’m still available in local fallback mode. I can prepare common Veyra actions now; full conversational AI becomes richer when a server-side AI provider is connected.',
    action: 'I understood the action. I’ve prepared a review card below. Veyra will verify the recipient, asset, route, and policy before anything can be signed.',
    clarifyRecipient: 'Who should receive it? You can use a Veyra ID, X handle, or wallet address.',
    clarifyAmount: 'How much would you like to use?',
    clarifyToken: 'Which asset do you want to use, for example USDC or EURC?',
    clarifyTargetToken: 'Which asset do you want to receive after the conversion?',
    clarifyDestination: 'Which destination network should Veyra use?',
  },
  vi: {
    hello: 'Chào bạn — mình là Veyra. Bạn cứ nói điều muốn làm với tiền của mình bằng tiếng Việt hoặc bất kỳ ngôn ngữ nào. Mình có thể giải thích Veyra, chuẩn bị thanh toán và tạo hành động để bạn kiểm tra.',
    help: 'Mình có thể giúp bạn trả tiền cho Veyra ID, tài khoản X hoặc ví; chuẩn bị chuyển đổi và route đa chuỗi; giải thích Veyra đang làm gì; và biến câu lệnh tự nhiên thành hành động để bạn duyệt. Mình không bao giờ tự ký thay bạn.',
    fallback: 'Mình vẫn hoạt động ở chế độ dự phòng cục bộ. Mình có thể chuẩn bị các hành động Veyra phổ biến; phần hội thoại sẽ đầy đủ hơn khi BFF kết nối nhà cung cấp AI.',
    action: 'Mình đã hiểu hành động. Thẻ kiểm tra đã được tạo bên dưới. Veyra sẽ xác minh người nhận, tài sản, route và policy trước khi bạn ký.',
    clarifyRecipient: 'Bạn muốn gửi cho ai? Có thể nhập Veyra ID, tài khoản X hoặc địa chỉ ví.',
    clarifyAmount: 'Bạn muốn dùng bao nhiêu?',
    clarifyToken: 'Bạn muốn dùng tài sản nào, ví dụ USDC hoặc EURC?',
    clarifyTargetToken: 'Bạn muốn nhận tài sản nào sau khi chuyển đổi?',
    clarifyDestination: 'Bạn muốn Veyra gửi tới mạng nào?',
  },
  es: {
    hello: 'Hola, soy Veyra. Dime qué quieres hacer con tu dinero en tu propio idioma. Puedo explicar Veyra, preparar pagos y crear acciones para que las revises.',
    help: 'Puedo ayudarte a pagar a un Veyra ID, una cuenta de X o una wallet; preparar conversiones y rutas entre cadenas; explicar cada paso; y convertir lenguaje natural en una acción revisable. Nunca firmo por ti.',
    fallback: 'Sigo disponible en modo local de respaldo. Puedo preparar acciones comunes de Veyra ahora; la conversación completa mejora cuando se conecta un proveedor de IA en el servidor.',
    action: 'Entendí la acción. Preparé una tarjeta de revisión. Veyra verificará destinatario, activo, ruta y políticas antes de cualquier firma.',
    clarifyRecipient: '¿Quién debe recibirlo? Puedes usar un Veyra ID, una cuenta de X o una dirección de wallet.',
    clarifyAmount: '¿Qué cantidad quieres usar?',
    clarifyToken: '¿Qué activo quieres usar, por ejemplo USDC o EURC?',
    clarifyTargetToken: '¿Qué activo quieres recibir después de la conversión?',
    clarifyDestination: '¿Qué red de destino debe usar Veyra?',
  },
  fr: {
    hello: 'Bonjour, je suis Veyra. Dites-moi ce que vous voulez faire avec votre argent dans votre langue. Je peux expliquer Veyra, préparer des paiements et créer des actions à vérifier.',
    help: 'Je peux vous aider à payer un Veyra ID, un compte X ou un wallet, préparer des conversions et des routes cross-chain, expliquer les étapes et transformer une demande naturelle en action vérifiable. Je ne signe jamais à votre place.',
    fallback: 'Je reste disponible en mode local de secours. Je peux préparer les actions Veyra courantes; la conversation devient plus riche lorsqu’un fournisseur IA serveur est connecté.',
    action: 'J’ai compris l’action. Une carte de vérification est prête ci-dessous. Veyra vérifiera le destinataire, l’actif, la route et la politique avant toute signature.',
    clarifyRecipient: 'Qui doit recevoir les fonds ? Utilisez un Veyra ID, un compte X ou une adresse wallet.',
    clarifyAmount: 'Quel montant souhaitez-vous utiliser ?',
    clarifyToken: 'Quel actif souhaitez-vous utiliser, par exemple USDC ou EURC ?',
    clarifyTargetToken: 'Quel actif souhaitez-vous recevoir après la conversion ?',
    clarifyDestination: 'Quel réseau de destination Veyra doit-il utiliser ?',
  },
  de: {
    hello: 'Hallo, ich bin Veyra. Sag mir in deiner Sprache, was du mit deinem Geld tun möchtest. Ich kann Veyra erklären, Zahlungen vorbereiten und Aktionen zur Prüfung erstellen.',
    help: 'Ich kann Zahlungen an Veyra IDs, X-Konten oder Wallets vorbereiten, Konvertierungen und Cross-Chain-Routen planen, Schritte erklären und natürliche Sprache in prüfbare Aktionen umwandeln. Ich signiere niemals für dich.',
    fallback: 'Ich bin weiterhin im lokalen Fallback-Modus verfügbar. Häufige Veyra-Aktionen funktionieren jetzt; die Unterhaltung wird mit einem serverseitigen KI-Anbieter umfangreicher.',
    action: 'Ich habe die Aktion verstanden. Unten ist eine Prüfkarte vorbereitet. Veyra verifiziert Empfänger, Asset, Route und Richtlinien vor jeder Signatur.',
    clarifyRecipient: 'Wer soll es erhalten? Du kannst eine Veyra ID, ein X-Konto oder eine Wallet-Adresse verwenden.',
    clarifyAmount: 'Welchen Betrag möchtest du verwenden?',
    clarifyToken: 'Welches Asset möchtest du verwenden, zum Beispiel USDC oder EURC?',
    clarifyTargetToken: 'Welches Asset möchtest du nach der Konvertierung erhalten?',
    clarifyDestination: 'Welches Zielnetzwerk soll Veyra verwenden?',
  },
  pt: {
    hello: 'Olá, eu sou a Veyra. Diga no seu idioma o que você quer fazer com seu dinheiro. Posso explicar a Veyra, preparar pagamentos e criar ações para sua revisão.',
    help: 'Posso ajudar a pagar um Veyra ID, conta X ou carteira; preparar conversões e rotas cross-chain; explicar cada etapa; e transformar linguagem natural em uma ação revisável. Nunca assino por você.',
    fallback: 'Continuo disponível no modo local de fallback. Posso preparar ações comuns da Veyra; a conversa completa melhora quando um provedor de IA do servidor está conectado.',
    action: 'Entendi a ação. Preparei um cartão de revisão abaixo. A Veyra verificará destinatário, ativo, rota e políticas antes de qualquer assinatura.',
    clarifyRecipient: 'Quem deve receber? Você pode usar um Veyra ID, conta X ou endereço de carteira.',
    clarifyAmount: 'Qual valor você quer usar?',
    clarifyToken: 'Qual ativo você quer usar, por exemplo USDC ou EURC?',
    clarifyTargetToken: 'Qual ativo você quer receber depois da conversão?',
    clarifyDestination: 'Qual rede de destino a Veyra deve usar?',
  },
  id: {
    hello: 'Halo, saya Veyra. Katakan apa yang ingin Anda lakukan dengan uang Anda dalam bahasa apa pun. Saya dapat menjelaskan Veyra, menyiapkan pembayaran, dan membuat tindakan untuk Anda tinjau.',
    help: 'Saya dapat membantu membayar Veyra ID, akun X, atau wallet; menyiapkan konversi dan rute lintas-chain; menjelaskan langkah-langkah; dan mengubah bahasa alami menjadi tindakan yang dapat ditinjau. Saya tidak pernah menandatangani untuk Anda.',
    fallback: 'Saya tetap tersedia dalam mode fallback lokal. Tindakan Veyra umum dapat disiapkan sekarang; percakapan penuh menjadi lebih baik saat penyedia AI server terhubung.',
    action: 'Saya memahami tindakannya. Kartu tinjauan sudah disiapkan di bawah. Veyra akan memverifikasi penerima, aset, rute, dan kebijakan sebelum penandatanganan.',
    clarifyRecipient: 'Siapa penerimanya? Gunakan Veyra ID, akun X, atau alamat wallet.',
    clarifyAmount: 'Berapa jumlah yang ingin digunakan?',
    clarifyToken: 'Aset apa yang ingin digunakan, misalnya USDC atau EURC?',
    clarifyTargetToken: 'Aset apa yang ingin diterima setelah konversi?',
    clarifyDestination: 'Jaringan tujuan mana yang harus digunakan Veyra?',
  },
  ja: {
    hello: 'こんにちは、Veyraです。お金で何をしたいか、あなたの言語でそのまま話してください。Veyraの説明、支払いの準備、確認用アクションの作成ができます。',
    help: 'Veyra ID、Xアカウント、ウォレットへの支払い、変換やクロスチェーン経路の準備、各ステップの説明、自然言語から確認可能なアクションへの変換を支援できます。あなたの代わりに署名することはありません。',
    fallback: 'ローカルのフォールバックモードでも利用できます。一般的なVeyraアクションは準備でき、サーバー側AIが接続されると会話機能がさらに豊かになります。',
    action: 'アクションを理解しました。下に確認カードを用意しました。署名前にVeyraが受取人、資産、ルート、ポリシーを検証します。',
    clarifyRecipient: '誰に送りますか？Veyra ID、Xアカウント、またはウォレットアドレスを使えます。',
    clarifyAmount: 'いくら使いますか？',
    clarifyToken: 'USDCやEURCなど、どの資産を使いますか？',
    clarifyTargetToken: '変換後にどの資産を受け取りたいですか？',
    clarifyDestination: '送信先ネットワークはどこですか？',
  },
  ko: {
    hello: '안녕하세요, Veyra입니다. 어떤 언어로든 돈으로 무엇을 하고 싶은지 말해 주세요. Veyra 설명, 결제 준비, 검토용 액션 생성을 도와드릴 수 있습니다.',
    help: 'Veyra ID, X 계정 또는 지갑으로 결제하고, 변환과 크로스체인 경로를 준비하고, 각 단계를 설명하고, 자연어를 검토 가능한 액션으로 바꿀 수 있습니다. 대신 서명하지 않습니다.',
    fallback: '로컬 폴백 모드에서도 계속 사용할 수 있습니다. 일반적인 Veyra 액션은 지금 준비할 수 있고, 서버 AI가 연결되면 대화 기능이 더 풍부해집니다.',
    action: '액션을 이해했습니다. 아래에 검토 카드를 준비했습니다. 서명 전에 Veyra가 수신자, 자산, 경로, 정책을 검증합니다.',
    clarifyRecipient: '누가 받아야 하나요? Veyra ID, X 계정 또는 지갑 주소를 사용할 수 있습니다.',
    clarifyAmount: '얼마를 사용하시겠어요?',
    clarifyToken: 'USDC 또는 EURC처럼 어떤 자산을 사용할까요?',
    clarifyTargetToken: '변환 후 어떤 자산을 받고 싶으신가요?',
    clarifyDestination: '어느 네트워크로 보낼까요?',
  },
  zh: {
    hello: '你好，我是 Veyra。你可以用自己的语言直接告诉我想如何使用资金。我可以解释 Veyra、准备付款，并生成供你确认的操作。',
    help: '我可以帮助你向 Veyra ID、X 账号或钱包付款，准备兑换和跨链路径，解释每一步，并把自然语言转换成可审核的操作。我不会替你签名。',
    fallback: '我仍可在本地备用模式下工作。常见的 Veyra 操作可以继续准备；连接服务器端 AI 后，对话能力会更完整。',
    action: '我已理解该操作。下面已经生成审核卡。签名前，Veyra 会验证收款人、资产、路径和策略。',
    clarifyRecipient: '谁来接收？你可以使用 Veyra ID、X 账号或钱包地址。',
    clarifyAmount: '你想使用多少？',
    clarifyToken: '你想使用哪种资产，例如 USDC 或 EURC？',
    clarifyTargetToken: '兑换后你希望收到哪种资产？',
    clarifyDestination: 'Veyra 应该使用哪个目标网络？',
  },
  th: {
    hello: 'สวัสดี ฉันคือ Veyra คุณสามารถบอกสิ่งที่ต้องการทำกับเงินด้วยภาษาของคุณเอง ฉันช่วยอธิบาย Veyra เตรียมการชำระเงิน และสร้างรายการให้คุณตรวจสอบได้',
    help: 'ฉันช่วยจ่ายไปยัง Veyra ID, บัญชี X หรือวอลเล็ต เตรียมการแปลงและเส้นทางข้ามเชน อธิบายแต่ละขั้นตอน และเปลี่ยนภาษาธรรมชาติเป็นรายการที่ตรวจสอบได้ ฉันจะไม่ลงนามแทนคุณ',
    fallback: 'ฉันยังใช้งานได้ในโหมดสำรองแบบโลคัล และเตรียมคำสั่ง Veyra ทั่วไปได้ เมื่อเชื่อมต่อผู้ให้บริการ AI ฝั่งเซิร์ฟเวอร์ การสนทนาจะสมบูรณ์ยิ่งขึ้น',
    action: 'ฉันเข้าใจคำสั่งแล้ว และเตรียมการ์ดให้ตรวจสอบด้านล่าง Veyra จะตรวจสอบผู้รับ สินทรัพย์ เส้นทาง และนโยบายก่อนการลงนาม',
    clarifyRecipient: 'ใครควรเป็นผู้รับ? ใช้ Veyra ID, บัญชี X หรือที่อยู่วอลเล็ตได้',
    clarifyAmount: 'ต้องการใช้จำนวนเท่าไร?',
    clarifyToken: 'ต้องการใช้สินทรัพย์ใด เช่น USDC หรือ EURC?',
    clarifyTargetToken: 'ต้องการรับสินทรัพย์ใดหลังการแปลง?',
    clarifyDestination: 'ต้องการใช้เครือข่ายปลายทางใด?',
  },
  ar: {
    hello: 'مرحبًا، أنا Veyra. أخبرني بلغتك بما تريد فعله بأموالك. يمكنني شرح Veyra وتجهيز المدفوعات وإنشاء إجراءات لمراجعتك.',
    help: 'يمكنني مساعدتك في الدفع إلى Veyra ID أو حساب X أو محفظة، وتجهيز التحويلات والمسارات عبر الشبكات، وشرح الخطوات، وتحويل اللغة الطبيعية إلى إجراء قابل للمراجعة. لن أوقّع نيابةً عنك.',
    fallback: 'ما زلت متاحًا في وضع النسخ الاحتياطي المحلي. يمكنني تجهيز إجراءات Veyra الشائعة، وتصبح المحادثة أشمل عند توصيل مزود ذكاء اصطناعي على الخادم.',
    action: 'فهمت الإجراء. أعددت بطاقة مراجعة أدناه. سيتحقق Veyra من المستلم والأصل والمسار والسياسة قبل أي توقيع.',
    clarifyRecipient: 'من هو المستلم؟ يمكنك استخدام Veyra ID أو حساب X أو عنوان محفظة.',
    clarifyAmount: 'ما المبلغ الذي تريد استخدامه؟',
    clarifyToken: 'ما الأصل الذي تريد استخدامه، مثل USDC أو EURC؟',
    clarifyTargetToken: 'ما الأصل الذي تريد استلامه بعد التحويل؟',
    clarifyDestination: 'ما شبكة الوجهة التي تريد أن يستخدمها Veyra؟',
  },
  hi: {
    hello: 'नमस्ते, मैं Veyra हूँ। आप अपनी भाषा में बताइए कि पैसे के साथ क्या करना चाहते हैं। मैं Veyra समझा सकता हूँ, भुगतान तैयार कर सकता हूँ और समीक्षा के लिए कार्रवाई बना सकता हूँ।',
    help: 'मैं Veyra ID, X अकाउंट या वॉलेट को भुगतान, कन्वर्ज़न और क्रॉस-चेन रूट की तैयारी, हर चरण की व्याख्या और प्राकृतिक भाषा को समीक्षा योग्य कार्रवाई में बदलने में मदद कर सकता हूँ। मैं आपकी ओर से साइन नहीं करता।',
    fallback: 'मैं लोकल फ़ॉलबैक मोड में भी उपलब्ध हूँ। सामान्य Veyra कार्रवाइयाँ तैयार की जा सकती हैं; सर्वर-साइड AI जुड़ने पर बातचीत और बेहतर होगी।',
    action: 'मैंने कार्रवाई समझ ली है। नीचे समीक्षा कार्ड तैयार है। साइन करने से पहले Veyra प्राप्तकर्ता, एसेट, रूट और पॉलिसी सत्यापित करेगा।',
    clarifyRecipient: 'किसे प्राप्त करना है? Veyra ID, X अकाउंट या वॉलेट एड्रेस उपयोग कर सकते हैं।',
    clarifyAmount: 'आप कितनी राशि उपयोग करना चाहते हैं?',
    clarifyToken: 'कौन-सा एसेट उपयोग करना चाहते हैं, जैसे USDC या EURC?',
    clarifyTargetToken: 'कन्वर्ज़न के बाद कौन-सा एसेट लेना चाहते हैं?',
    clarifyDestination: 'Veyra को किस गंतव्य नेटवर्क का उपयोग करना चाहिए?',
  },
} as const;

export function detectAgentLocale(message: string): string {
  const text = message.trim();
  if (!text) return 'en';
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(text)) return 'ko';
  if (/[\u0e00-\u0e7f]/u.test(text)) return 'th';
  if (/[\u0600-\u06ff]/u.test(text)) return 'ar';
  if (/[\u0900-\u097f]/u.test(text)) return 'hi';
  if (/[\u4e00-\u9fff]/u.test(text)) return 'zh';
  if (/[а-яё]/iu.test(text)) return 'ru';
  if (/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(text)) return 'vi';

  const lower = ` ${text.toLowerCase()} `;
  if (/\b(hola|gracias|enviar|envía|puedo|quiero|para)\b/u.test(lower)) return 'es';
  if (/\b(bonjour|merci|envoyer|je veux|pour)\b/u.test(lower)) return 'fr';
  if (/\b(hallo|danke|senden|ich möchte|überweisen)\b/u.test(lower)) return 'de';
  if (/\b(olá|obrigado|enviar|quero|para)\b/u.test(lower)) return 'pt';
  if (/\b(halo|kirim|saya|tolong|berapa)\b/u.test(lower)) return 'id';
  if (/\b(merhaba|gönder|lütfen|istiyorum)\b/u.test(lower)) return 'tr';
  return 'en';
}

function buildIntent(message: string, locale: string): IntentResult | undefined {
  const tokens = extractTokens(message);
  const chains = extractChains(message);
  const amount = extractAmount(message);
  const recipient = extractRecipient(message);

  const isBridge = hasAny(message, BRIDGE_HINTS);
  const isConvert = !isBridge && hasAny(message, CONVERT_HINTS);
  const isTransfer = !isBridge && !isConvert && (hasAny(message, TRANSFER_HINTS) || Boolean(recipient && amount));
  if (!isBridge && !isConvert && !isTransfer) return undefined;

  if (isTransfer) {
    const missing: string[] = [];
    if (!recipient) missing.push('recipientRaw');
    if (!amount) missing.push('amountRaw');
    if (!tokens[0]) missing.push('tokenRaw');
    const status = missing.length ? 'NEEDS_CLARIFICATION' : 'RESOLVED';
    const clarificationQuestion = missing.includes('recipientRaw')
      ? localized(locale, 'clarifyRecipient')
      : missing.includes('amountRaw')
        ? localized(locale, 'clarifyAmount')
        : missing.includes('tokenRaw')
          ? localized(locale, 'clarifyToken')
          : undefined;
    return validateIntentResponse({
      displaySummary: localized(locale, 'action'),
      status,
      candidates: [{
        actionType: 'TRANSFER',
        recipient,
        fromAmount: amount,
        fromCurrency: tokens[0],
        sourceChain: chains[0],
        destinationChain: chains.length > 1 ? chains[chains.length - 1] : chains[0],
        confidence: 0.78,
      }],
      missingParams: missing,
      clarificationQuestion,
      parsedAt: Date.now(),
    });
  }

  if (isConvert) {
    const sourceToken = tokens[0];
    const targetToken = tokens[1];
    const missing: string[] = [];
    if (!amount) missing.push('amountRaw');
    if (!sourceToken) missing.push('tokenRaw');
    if (!targetToken) missing.push('targetTokenRaw');
    const status = missing.length ? 'NEEDS_CLARIFICATION' : 'RESOLVED';
    const clarificationQuestion = missing.includes('amountRaw')
      ? localized(locale, 'clarifyAmount')
      : missing.includes('tokenRaw')
        ? localized(locale, 'clarifyToken')
        : missing.includes('targetTokenRaw')
          ? localized(locale, 'clarifyTargetToken')
          : undefined;
    return validateIntentResponse({
      displaySummary: localized(locale, 'action'),
      status,
      candidates: [{
        actionType: 'CONVERT',
        fromAmount: amount,
        fromCurrency: sourceToken,
        toCurrency: targetToken,
        sourceChain: chains[0],
        confidence: 0.76,
      }],
      missingParams: missing,
      clarificationQuestion,
      parsedAt: Date.now(),
    });
  }

  const missing: string[] = [];
  if (!amount) missing.push('amountRaw');
  if (!tokens[0]) missing.push('tokenRaw');
  if (!chains[0]) missing.push('sourceChainRaw');
  if (!chains[1]) missing.push('destinationChainRaw');
  const status = missing.length ? 'NEEDS_CLARIFICATION' : 'RESOLVED';
  const clarificationQuestion = missing.includes('amountRaw')
    ? localized(locale, 'clarifyAmount')
    : missing.includes('tokenRaw')
      ? localized(locale, 'clarifyToken')
      : localized(locale, 'clarifyDestination');
  return validateIntentResponse({
    displaySummary: localized(locale, 'action'),
    status,
    candidates: [{
      actionType: 'BRIDGE',
      fromAmount: amount,
      fromCurrency: tokens[0],
      sourceChain: chains[0],
      destinationChain: chains[1],
      confidence: 0.74,
    }],
    missingParams: missing,
    clarificationQuestion,
    parsedAt: Date.now(),
  });
}

function isGreeting(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return /^(hi|hey|hello|yo|xin chào|chào|hola|bonjour|hallo|olá|ola|halo|こんにちは|你好|안녕|สวัสดี|مرحبا|नमस्ते)\b/u.test(lower);
}

function isHelpQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    'what can you do', 'how can you help', 'what is veyra', 'help me',
    'bạn làm được gì', 'veyra là gì', 'giúp tôi', 'giúp mình',
    'qué puedes hacer', 'que puedes hacer', 'qu’est-ce que tu peux', 'que peux-tu faire',
    'was kannst du', 'o que você pode', 'apa yang bisa', '何ができ', '能做什么', '무엇을 할 수',
  ].some((phrase) => lower.includes(phrase));
}

function looksLikeFinancialFragment(message: string): boolean {
  return Boolean(
    extractRecipient(message)
    || extractAmount(message)
    || extractTokens(message).length
    || extractChains(message).length,
  );
}

export function createFallbackAgentResponse(
  message: string,
  options: { provider?: string; executionAvailable?: boolean; history?: AgentHistoryMessage[] } = {},
): AgentChatResponse {
  const clean = sanitizeText(message, 2000);
  const locale = detectAgentLocale(clean);
  let intent = buildIntent(clean, locale);

  // Keep clarification flows usable even when the BFF/model is offline. If the
  // latest message looks like a financial fragment (for example "@alice" after
  // "send 20 USDC"), fold in only the recent USER context and re-run the
  // deterministic parser. Agent replies are never used as financial input.
  if (!intent && looksLikeFinancialFragment(clean) && options.history?.length) {
    const recentUserContext = options.history
      .filter((item) => item.role === 'user')
      .slice(-2)
      .map((item) => sanitizeText(item.text, 500))
      .filter(Boolean)
      .join('\n');
    if (recentUserContext) intent = buildIntent(`${recentUserContext}\n${clean}`, locale);
  }
  const provider = options.provider ?? 'local-fallback';
  const capabilities: AgentCapabilities = {
    conversation: 'FALLBACK',
    planning: 'FALLBACK',
    execution: options.executionAvailable ? 'AVAILABLE' : 'LOCKED',
    provider,
  };

  if (intent) {
    const needsClarification = intent.status === 'NEEDS_CLARIFICATION';
    return {
      ok: true,
      reply: needsClarification
        ? (intent.clarificationQuestion ?? localized(locale, 'fallback'))
        : localized(locale, 'action'),
      locale,
      mode: needsClarification ? 'CLARIFICATION' : 'ACTION',
      intent,
      degraded: true,
      capabilities,
    };
  }

  return {
    ok: true,
    reply: isGreeting(clean)
      ? localized(locale, 'hello')
      : isHelpQuestion(clean)
        ? localized(locale, 'help')
        : localized(locale, 'fallback'),
    locale,
    mode: 'CHAT',
    degraded: true,
    capabilities,
  };
}

export function validateAgentChatResponse(
  rawInput: unknown,
  fallbackMessage: string,
  fallbackCapabilities?: Partial<AgentCapabilities>,
): AgentChatResponse {
  const fallback = createFallbackAgentResponse(fallbackMessage, {
    provider: fallbackCapabilities?.provider,
    executionAvailable: fallbackCapabilities?.execution === 'AVAILABLE',
  });
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) return fallback;
  const raw = rawInput as Record<string, unknown>;
  const reply = sanitizeText(raw.reply, 1200);
  const locale = sanitizeText(raw.locale, 24) || fallback.locale;
  const mode: AgentMode = raw.mode === 'ACTION' || raw.mode === 'CLARIFICATION' || raw.mode === 'CHAT'
    ? raw.mode
    : fallback.mode;
  const rawCaps = raw.capabilities && typeof raw.capabilities === 'object' && !Array.isArray(raw.capabilities)
    ? raw.capabilities as Record<string, unknown>
    : {};
  const capabilities: AgentCapabilities = {
    conversation: rawCaps.conversation === 'ONLINE' ? 'ONLINE' : rawCaps.conversation === 'FALLBACK' ? 'FALLBACK' : fallback.capabilities.conversation,
    planning: rawCaps.planning === 'ONLINE' ? 'ONLINE' : rawCaps.planning === 'FALLBACK' ? 'FALLBACK' : fallback.capabilities.planning,
    // Execution capability is transport/runtime authority, never model output.
    execution: fallbackCapabilities?.execution === 'AVAILABLE' ? 'AVAILABLE' : 'LOCKED',
    provider: sanitizeText(rawCaps.provider, 80) || fallback.capabilities.provider,
  };
  const intent = raw.intent ? validateIntentResponse(raw.intent) : undefined;
  return {
    ok: true,
    reply: reply || fallback.reply,
    locale,
    mode: intent?.status === 'NEEDS_CLARIFICATION' ? 'CLARIFICATION' : mode,
    ...(intent ? { intent } : {}),
    degraded: raw.degraded === true,
    capabilities,
  };
}
