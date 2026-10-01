// ピタ止めチョーキング (bend-trainer) — ギターなしでチョーキングの音程を練習する。自己完結・CDN依存なし
// 画面の弦を押さえて上へずらすと、実際の弦と同じ曲線で音程が上がる。目標の高さで止められたかを判定する。
// 実機での調整は下記 CONFIG のみで完結させる（マジックナンバー禁止）。
// 通常スクリプト（ESモジュールではない）: index.html をダブルクリック(file://)で開ける。
// 対応の目安: Safari 14.1 / iOS 14.5 以降（ConstantSourceNode と PeriodicWave を使う）

const CONFIG = {
  // --- 判定（チョーキングチェッカーと同じ設計値） ---
  targets: [
    { key: 'half', label: '半音', cents: 100 },
    { key: 'whole', label: '1音', cents: 200 },
    { key: 'oneHalf', label: '1音半', cents: 300 },
  ],
  targetDefault: 'whole',
  toleranceCents: 20,           // 許容幅 ±
  holdMs: 200,                  // 目標の帯にいた時間の合計がこれに達したら ◯
  overHoldMs: 150,              // 帯より上に続けてこれだけいたら「高い」
  maxFrameDtMs: 100,            // 1フレームの時間加算上限（タブ復帰直後の暴走防止）
  attemptMinCents: 30,          // これ未満しか上げていないタッチは「試行」に数えない

  // --- 耳だけモードの判定: 離す直前に止めていた高さ（中央値）で決める ---
  heldWindowMs: 200,            // 高さを見る時間の幅
  releaseTrimMs: 50,            // 離す瞬間の指のぶれを捨てる時間
  stillSpanCents: 30,           // 上の幅の中でこれ以上ゆれていたら「止まらずに離した」と知らせる（判定は変えない）
  traceKeepMs: 1000,            // 高さの記録を保持する時間

  // --- 表示モード ---
  modes: [
    { key: 'meter', label: 'メーター' },
    { key: 'ear', label: '耳だけ' },
  ],
  modeDefault: 'meter',
  nudgeAfterOk: 5,              // メーターで ◯ がこの回数たまったら「耳だけ」をすすめる

  // --- 楽器（物理モデル） ---
  // 弦長・ナットからペグまでの長さ・鋼の定数は Kemp 2017。弦の間隔はナットとブリッジの一般的な寸法
  a4Hz: 440,
  scaleMm: 648,                 // 弦長（フェンダー系）
  youngPa: 207e9,               // 鋼のヤング率
  densityKgM3: 7860,            // 鋼の密度
  nutSpreadMm: 35.06,           // ナット位置での 1弦〜6弦の幅
  bridgeSpreadMm: 52.4,         // ブリッジ位置での 1弦〜6弦の幅
  stringCount: 6,
  // tau = 弦全体の質量 ÷ 芯線の質量（プレーン弦は 1。巻き弦は芯線だけが張力を受ける）。Kemp 2017 Table 2 の実測（.024/.032/.042）。
  //   10-46 のセットでは ±10% ほど違うが、移動量には平方根で効くので ±5%（12F の1音で ±0.8mm）
  // deadMm = ナットからペグまでの長さ（Kemp 2017 Table 1、ストラトの6連ペグ）
  // bendDown = 上に余裕がない弦は、実物と同じく下へ引く（画面でも下へ動かす）
  strings: [
    { key: '1', label: '1弦', number: 1, openMidi: 64, tau: 1, deadMm: 159.1 },
    { key: '2', label: '2弦', number: 2, openMidi: 59, tau: 1, deadMm: 135.4 },
    { key: '3', label: '3弦', number: 3, openMidi: 55, tau: 1, deadMm: 112.3 },
    { key: '4', label: '4弦', number: 4, openMidi: 50, tau: 2.76, deadMm: 87.9, bendDown: true },
    { key: '5', label: '5弦', number: 5, openMidi: 45, tau: 3.59, deadMm: 64.5, bendDown: true },
    { key: '6', label: '6弦', number: 6, openMidi: 40, tau: 4.76, deadMm: 41.1, bendDown: true },
  ],
  stringDefault: '3',
  frets: Array.from({ length: 22 }, (_, i) => i + 1),   // 22フレットのギター
  fretDefault: 12,
  maxBendCents: 360,            // 音程の上限（1音半の「高い」を判定できる高さまで）
  bisectIters: 40, bisectMaxMm: 60,

  // --- 画面（CSS px） ---
  // 盤は「選んだフレットを中央に置いた、実物と同じ比率のクローズアップ」。縦（弦の間隔）も横（フレットの幅）も
  // 同じ縮尺 pxPerMm で描くので、実物のネックと同じ見え方になる（フレット幅は弦の間隔の約2倍）
  pxPerMm: 11.5,                // 指の移動 11.5px = 弦の移動 1mm。盤が低いと、弦ごとに自動で縮む
  // 低いフレットは弦が硬く、少しの移動で大きく上がる。そこでは指 1px あたりの変化が centsPerPxZoom を超えないところまで拡大する
  zoomRefCents: 200,            // 拡大の判断に使う高さ
  centsPerPxZoom: 3,
  pxPerMmMax: 24,               // 拡大の上限
  centsPerPxMax: 6,             // 目標の高さで、指 1px あたりの音程の変化がこれを超えたら「画面が低すぎます」
  edgeInsetPx: 12,              // 盤の左右端（画面端は iOS の戻るスワイプ）を避ける。盤自体も画面端から離してある
  stringRestFromEdgePx: 56,     // 弾く弦の位置。押し上げる弦は盤の下端から、引き下げる弦は上端から。
                                // 指の進む先の反対側にある弦（1弦側 / 6弦側）は、縮尺を縮めずに入るぶんだけ盤に入れる
  hitHalfPx: 44,                // 弦の、指が進む側はこの幅まで、反対側は盤の端までを「押さえた」とみなす
  travelMarginPx: 16,           // 指を動かせる範囲の端（盤の上端、またはフレット番号の帯）からの余白
  pressBehindMm: 6,             // 押さえる位置: フレットの金属のすぐ手前（升の半分より手前にはしない）
  nutMm: 5,                     // ナットの厚み
  boardEndMm: 10,               // 最終フレットから指板の端まで
  inlayFrets: [3, 5, 7, 9, 15, 17, 19, 21], inlayDoubleFrets: [12],   // ポジションマークのあるフレット（12 は2つ）
  inlayRadiusPx: 6,
  edgeBeyondGap: 0.5,           // 外側の弦から指板のふちまで（弦の間隔に対する割合）
  bindingPx: 3,                 // 指板のふちの縁取りの太さ
  fretWirePx: 5, fretGroovePx: 1.5,   // フレットの金属の幅と、両脇の溝
  stringGaugePx: [0, 1.3, 1.6, 2.0, 2.8, 3.5, 4.2],   // 弦の太さ（添字 = 弦番号。0 は使わない）
  woundFrom: 4,                 // この番号以上は巻き弦（色を変える）
  stringShadowDyPx: 3, stringShadowExtraPx: 1.5, stringHighlightDyPx: -1,   // 弦の影と光の線
  stringHighlightRatio: 0.33, stringHighlightMinPx: 1,                       // 光の線の太さ（弦の太さに対する割合と下限）
  activeExtraPx: 0.8, activeGlowPx: 10,   // 弾く弦は少し太く、淡い光をまとう
  touchDotRadiusPx: 22, touchHaloRatio: 1.9, pressCoreRatio: 0.3, pressGlowRatio: 2.6, pushedGapPx: 5,
  labelFontPx: 11, labelPadPx: 6, fretNumFontPx: 13, fretStripPx: 30, hintFontPx: 16,
  fretNumMinCellEm: 2,          // 端で欠けた升がこの幅（文字サイズの倍数）未満なら番号を出さない
  hintMs: 1500,                 // 一時的な案内を出しておく時間
  badgeMs: 700,                 // 判定の印を強く見せる時間
  meterMaxCents: 250, meterMaxCentsHigh: 350,
  meterTicks: [0, 100, 200, 300],
  historyLen: 10,
  historyViewBox: '0 0 16 16',  // 履歴の印: 空き=小さい点 / ◯=丸 / 低い=下向き三角 / 高い=上向き三角（形で見分けられるように）
  historyShapes: {
    empty: 'M8 6.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z',
    ok: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z',
    shallow: 'M2 3.5h12L8 13.5z',
    over: 'M2 12.5h12L8 2.5z',
  },
  biasSmallCents: 5,            // ずれの平均がこれ以内なら「ほぼ中央」
  keyStepMm: 0.5,               // キーボードの ↑↓ 1回ぶんの弦の移動量

  // --- 音（倍音ごとの減り方を4つの束に分けた加算合成） ---
  pluckMm: 100,                 // ピックの位置（ブリッジから）
  pickupMm: 98,                 // ピックアップの位置。162 だと 12フレットで偶数倍音が全部消える
  pickupResHz: 3500, pickupQ: 1.0,
  maxPartialHz: 8000, maxPartials: 64,
  groupEnds: [1, 3, 8],         // 束の区切り: 倍音 1 / 2〜3 / 4〜8 / 9以上
  decayBase: 0.30,              // 減衰の速さ sigma(f) = decayBase + decayPerKHz × f/1000  [1/秒]
  decayPerKHz: 0.80,
  attackS: 0.003,
  targetRmsA: 0.1,              // 鳴らし始めの音量（A特性つき実効値）
  notePeakMax: 0.34,            // 1音のピークの上限（masterGain を掛ける前）。倍音が多い低い音（6弦 8F 以下・5弦 3F 以下の 11 音）は
                                // この上限に当たり、目標より最大 2.2dB 小さくなる
  peakScanSteps: 2048,          // 1周期のピークを探す細かさ
  masterGain: 1.7,              // 1音だけなら、どの音も安全弁(0.8)の手前（最大 0.58）。280Hz 以上の音は 2つ重なっても手前。
                                // 2つ重なると安全弁を超えるのは 54 音（2弦 2F・3弦 6F・4弦 11F・5弦 16F・6弦 19F より低い位置。6弦 20〜21F は
                                // 280Hz 未満だが超えない）。実時間では弾き直すたびに、古い音が新しい音の開始後 34ms（fadeLeadS − pluckLeadS）残る。
                                // 低い音は減衰が遅い（6弦で 3.8dB/秒）ので、1〜1.5 秒以内の弾き直しはこの 34ms だけ安全弁に入る。
                                // 和は最大 1.16 で、安全弁は入力 ±limiterHeadroom まで曲線で丸める（平らに切らない）。出力は 1.0 未満（実測 0.97）。
                                // 自己診断の「ピーク」はオフライン（重なりなし）なので、この 34ms は見えない。測るのはハーネスの measure.mjs
  limiterKnee: 0.8, limiterPoints: 1025,
  limiterHeadroom: 2,           // 安全弁の曲線が受ける入力の範囲（±）。これを超えると平らに切れる
  bendTau: 0.008,               // 指の動きに音程が追いつく速さ
  bendSendMinCents: 0.1,        // これ以上変わった時だけ音程を送る
  muteTau: 0.03, replaceTau: 0.005,
  // 実時間では「いま」の時刻が音声側ではもう過去なので、少し先の時刻から始める。
  // 過去の時刻から消し始めると減衰の途中の値に飛び、プチッと鳴る（Firefox で実測）。
  // 40ms あれば、メインスレッドが 30ms ほど詰まっていても間に合う（それ以上詰まると Firefox では鳴りうる）
  fadeLeadS: 0.04,
  pluckLeadS: 0.006,            // 弾き始めも少し先の時刻に置く（立ち上がりが毎回同じ形になる）
  muteStopTaus: 12,             // 消音を始めてから発振を止めるまで（時定数の何倍か）
  voiceMaxS: 12,                // 1音の最長。鳴り終わったら試行も終える
  refLeadS: 0.02, refBaseS: 0.5, refGapS: 0.1, refTargetS: 0.7,   // お手本: もとの音 → 目標の音
  autoRefDelayMs: 350,          // 耳だけモードで課題が変わった時、お手本を自動で鳴らすまでの間（案内が出ている間は読み終わるまで待つ）

  // --- 自己診断 (?selftest=1)。数字はオフライン合成で見る窓と合格基準 ---
  selftest: {
    sampleRate: 44100,
    normRenderS: 0.1, normPeak: 0.25, normTol: 0.005,   // 波形の正規化なしが効いているか
    pitchFromS: 0.3, pitchLenS: 0.3, pitchTailS: 0.1, lagSearch: 6,
    pitchTolCents: 2,                   // 音程の誤差
    levelDbTol: 0.5,                    // 音量の誤差（減衰を含めた設計値との差）
    earlyFromS: 0.02, earlyToS: 0.12,   // 鳴らし始めの音量を見る窓
    lateFromS: 1.0, lateToS: 1.2,       // 減衰を見る窓
    notePeakS: 0.05, notePeakDbTol: 0.5,  // 1音のピークと設計値の差（安全弁が音を変えていないか）
    mutedFromS: 0.1, mutedToS: 0.15, mutedDb: -25,   // 消音してからこの窓での音量
    eventAtS: 0.3, eventPhases: 8,      // 消音・弾き直しを入れる時刻と、1周期を何等分して試すか
    replucks: 5, repluckEveryS: 0.1, bendSteps: 18, bendRate: 60,   // 最悪の操作: お手本の途中で弾き直しを重ね、上限まで上げる
    fadeTailS: 0.05,                    // 発振を止めたあと、さらに見ておく長さ
    cleanupWaitMs: 500,                 // 発振が止まった通知を待つ上限
    fadeErrMax: 0.01,                   // 消え方の設計（指数で消える）との差。プチッという段差があると超える
  },

  storageKey: 'bend-trainer.settings.v1',
};

// ============================================================
// 純ロジック（Node からもテスト可能）
// ============================================================
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RESULT_WORD = { ok: '◯', shallow: '低い', over: '高い' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const midiToHz = (midi) => CONFIG.a4Hz * Math.pow(2, (midi - 69) / 12);
const findByKey = (list, key, fallbackKey) =>
  list.find((x) => x.key === key) || list.find((x) => x.key === fallbackKey);

const openHz = (string) => midiToHz(string.openMidi);
const baseMidi = (string, fret) => string.openMidi + fret;
const baseHz = (string, fret) => midiToHz(baseMidi(string, fret));

function noteName(midi) {
  const n = Math.round(midi);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 符号つきセント表記（−は U+2212）
function formatCents(cents) {
  const r = Math.round(cents);
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r) + '¢';
}

// 保存されていた設定を確かめて、使える値だけ採る
function readSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    target: findByKey(CONFIG.targets, s.target, CONFIG.targetDefault).key,
    mode: findByKey(CONFIG.modes, s.mode, CONFIG.modeDefault).key,
    string: findByKey(CONFIG.strings, s.string, CONFIG.stringDefault).key,
    fret: CONFIG.frets.includes(s.fret) ? s.fret : CONFIG.fretDefault,
  };
}

// 張った状態での弦の伸び率
function strainAtPitch(string) {
  const v = 2 * (CONFIG.scaleMm / 1000) * openHz(string);
  return (string.tau * CONFIG.densityKgM3 * v * v) / CONFIG.youngPa;
}

// 弦を横に dMm ずらした時の音程の上がり（セント）。弦が2本の直線になり、伸びたぶん張力が上がる
function bendCents(dMm, string, fret) {
  const d = Math.abs(dMm), L = CONFIG.scaleMm;
  if (d === 0) return 0;                    // 丸め誤差を出さない（弾いた瞬間はちょうど 0¢）
  const L2 = L * Math.pow(2, -fret / 12), L1 = L - L2;
  const S0 = L + string.deadMm;
  const S = Math.hypot(L1, d) + Math.hypot(L2, d) + string.deadMm;
  const eps0 = strainAtPitch(string);
  const tension = ((1 + eps0) * S / S0 - 1) / eps0;
  const ratio = (L2 / Math.hypot(L2, d)) * Math.sqrt(tension * S / S0);
  return 1200 * Math.log2(ratio);
}

// 逆: その音程にするのに必要な移動量（二分法）
function bendMm(cents, string, fret) {
  let lo = 0, hi = CONFIG.bisectMaxMm;
  for (let i = 0; i < CONFIG.bisectIters; i++) {
    const mid = (lo + hi) / 2;
    if (bendCents(mid, string, fret) < cents) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// そのフレットでの隣の弦との間隔
function spacingMm(fret) {
  const gaps = CONFIG.stringCount - 1;
  return CONFIG.nutSpreadMm / gaps
    + ((CONFIG.bridgeSpreadMm - CONFIG.nutSpreadMm) / gaps) * (1 - Math.pow(2, -fret / 12));
}

// ある音程のところで、指を 1px 動かすと何セント変わるか
function centsPerPx(cents, string, fret, pxPerMm) {
  const mm = bendMm(cents, string, fret), half = 0.5 / pxPerMm;
  return bendCents(mm + half, string, fret) - bendCents(Math.max(0, mm - half), string, fret);
}

// 画面の縮尺（盤に余裕がある時）: 弦が硬い位置（低いフレット）は指 1px あたりの変化が大きくなりすぎないところまで拡大する
function pxPerMmWanted(string, fret) {
  const c = CONFIG;
  const centsPerMm = centsPerPx(c.zoomRefCents, string, fret, 1);
  return clamp(centsPerMm / c.centsPerPxZoom, c.pxPerMm, c.pxPerMmMax);
}

// 画面の縮尺: 上限の音程まで上げても盤に収まるところまで縮める
function pxPerMmFor(roomPx, string, fret) {
  return Math.min(pxPerMmWanted(string, fret), Math.max(roomPx, 1) / bendMm(CONFIG.maxBendCents, string, fret));
}

// 指を動かせる範囲（px）: 押し上げは弦から盤の上端の余白まで、引き下げは弦からフレット番号の帯の手前まで。指の円が端に食い込まない
function roomFrom(boardH, string, restY) {
  const m = Math.max(CONFIG.travelMarginPx, CONFIG.touchDotRadiusPx);
  return string.bendDown ? boardH - CONFIG.fretStripPx - m - restY : restY - m;
}

// 弾く弦の位置（盤の上端から）。押し上げる弦は盤の下のほうに置いて上へ、引き下げる弦は上のほうに置いて下へ動かす。
// 指の進む先の反対側にある弦（押し上げなら 1弦側、引き下げなら 6弦側）は、縮尺を縮めずに上限まで動かせる範囲で盤に入れる
function restYFor(boardH, string, fret) {
  const c = CONFIG, down = string.bendDown === true;
  const wanted = pxPerMmWanted(string, fret);
  const gap = spacingMm(fret) * wanted, cap = bendMm(c.maxBendCents, string, fret) * wanted;
  const behind = down ? c.stringCount - string.number : string.number - 1;
  const edgeY = down ? c.stringRestFromEdgePx : boardH - c.stringRestFromEdgePx;
  for (let k = behind; k > 0; k--) {
    const restY = down ? edgeY + k * gap : edgeY - k * gap;
    if (roomFrom(boardH, string, restY) >= cap) return restY;
  }
  return edgeY;
}

function travelRoomPx(boardH, string, fret) {
  return roomFrom(boardH, string, restYFor(boardH, string, fret));
}

// ---------- 判定 ----------
// IDLE →（押さえる）→ LOCKED →（離す）→ IDLE。判定の材料はすべてここで数える
class BendJudge {
  constructor(config) {
    this.cfg = config;
    this.target = findByKey(config.targets, config.targetDefault).cents;
    this.tolerance = config.toleranceCents;
    this.cancel();
  }

  // 目標の切替（試行の外で呼ぶ）
  setTarget(cents) {
    this.target = cents;
    this.bandMs = 0;
    this.overMs = 0;
  }

  start() {
    this.state = 'LOCKED';
    this.t = 0;
    this.bandMs = 0;
    this.overMs = 0;
    this.peak = 0;
    this.live = null;           // 押さえている間に出た判定（実機チェッカーと同じ規則）
    this.liveCents = 0;
    this.arrivalMs = null;      // 初めて帯に入った時刻
    this.overAfterOk = false;
    this.trace = [];            // [時刻ms, セント]
    this.peakOld = 0;           // 記録から押し出した古い部分の最大
  }

  cancel() {
    this.state = 'IDLE';
    this.trace = [];
    this.live = null;
  }

  // 1フレームぶん進める。このフレームで判定が出たらその種類を返す
  process({ cents, dt }) {
    if (this.state !== 'LOCKED') return null;
    const c = this.cfg;
    dt = Math.min(dt, c.maxFrameDtMs);
    this.t += dt;
    this.trace.push([this.t, cents]);
    while (this.trace.length > 1 && this.trace[0][0] < this.t - c.traceKeepMs) {
      this.peakOld = Math.max(this.peakOld, this.trace.shift()[1]);
    }
    if (cents > this.peak) this.peak = cents;

    const lo = this.target - this.tolerance, hi = this.target + this.tolerance;
    if (cents >= lo && cents <= hi) {
      this.bandMs += dt;                                 // 帯の中は合計
      if (this.arrivalMs === null) this.arrivalMs = this.t;
    }
    if (cents > hi) this.overMs += dt; else this.overMs = 0;   // 超過は連続

    if (this.live) {
      if (this.live === 'ok' && this.overMs >= c.overHoldMs) this.overAfterOk = true;
      return null;
    }
    if (this.bandMs >= c.holdMs) this.live = 'ok';
    else if (this.overMs >= c.overHoldMs) this.live = 'over';
    if (this.live) this.liveCents = cents;
    return this.live;
  }

  // いまの時点のまとめ（試行は続ける）
  summary() {
    const c = this.cfg;
    const lo = this.target - this.tolerance, hi = this.target + this.tolerance;
    const end = this.t - c.releaseTrimMs, begin = end - c.heldWindowMs;
    const held = this.trace.filter(([t]) => t >= begin && t <= end).map(([, v]) => v);
    // 止めていたと言えるだけの長さがない試行（さっと弾いて離した）は、最大の高さで見る。
    // 帯に届いていても「止めが短い」ので ◯ にはしない
    const tooShort = this.t < c.heldWindowMs + c.releaseTrimMs || !held.length;
    // 止めていた試行では、離す瞬間の指のぶれを最大の高さからも捨てる（離す直前までの最大）
    const trimmed = tooShort ? [] : this.trace.filter(([t]) => t <= end).map(([, v]) => v);
    const peak = trimmed.length ? Math.max(this.peakOld, ...trimmed) : this.peak;
    const heldCents = tooShort ? peak : median(held);
    const heldSpan = tooShort ? 0 : Math.max(...held) - Math.min(...held);
    const kindOf = (v) => (v > hi ? 'over' : v < lo || tooShort ? 'shallow' : 'ok');
    return {
      attempted: this.peak >= c.attemptMinCents,
      target: this.target, tolerance: this.tolerance,
      live: this.live, liveCents: this.liveCents,
      // メーター表示での判定: 実機チェッカーの規則に加えて、届かずに離した時は最大が帯を超えていれば「高い」
      checker: this.live || (peak > hi ? 'over' : 'shallow'),
      final: kindOf(heldCents),                          // 離す直前に止めていた高さでの判定
      heldCents, heldSpan, tooShort,
      still: !tooShort && heldSpan <= c.stillSpanCents,
      peakCents: peak,
      arrivalMs: this.arrivalMs,
      durationMs: this.t,
      bandMs: this.bandMs,
      overAfterOk: this.overAfterOk,
    };
  }

  // 離した時点のまとめを返して、試行を終える
  release() {
    if (this.state !== 'LOCKED') return null;
    const info = this.summary();
    this.cancel();
    return info;
  }
}

// 表示モードごとの「主の判定」と、その時に見せる音程
function primaryResult(info, mode) {
  if (mode === 'ear') return { kind: info.final, cents: info.heldCents };
  if (info.live) return { kind: info.live, cents: info.liveCents };
  return { kind: info.checker, cents: info.peakCents };
}

// 結果の一文（向きと量を言う）。帯を少し出ただけの時に、許容幅と同じ数字（20¢）を書かない
function resultText(info, mode) {
  const { kind, cents } = primaryResult(info, mode);
  const lo = info.target - info.tolerance;
  const amount = (diff) => Math.max(info.tolerance + 1, Math.round(diff));
  if (kind === 'ok') {
    if (mode === 'meter' && info.overAfterOk) return `◯ のあと上げすぎ　最大 ${formatCents(info.peakCents)}`;
    return `◯ ぴったり　${formatCents(cents)}`;
  }
  if (kind === 'over') return `高い　${amount(cents - info.target)}¢上げすぎ`;
  if (cents >= lo) return '低い　届いたが止めが短い';
  return `低い　目標まであと${amount(info.target - cents)}¢`;
}

// 補足の数字（判定は変えない）。帯の端から 1¢ 以内の値は小数1桁で書く（四捨五入で帯の中の数字に見えないように）
function reviewText(info, mode) {
  const lo = info.target - info.tolerance, hi = info.target + info.tolerance;
  const fine = (c) => {
    if (Math.abs(c - lo) >= 1 && Math.abs(c - hi) >= 1) return formatCents(c);
    return (c > 0 ? '+' : c < 0 ? '−' : '±') + Math.abs(c).toFixed(1) + '¢';
  };
  const parts = [];
  if (info.tooShort) {
    parts.push(`最大 ${fine(info.peakCents)}`, '止める前に離しました');
  } else {
    parts.push(`止めた高さ ${fine(info.heldCents)}`, `最大 ${fine(info.peakCents)}`);
    if (info.arrivalMs !== null) parts.push(`到達 ${(info.arrivalMs / 1000).toFixed(1)}秒`);
    parts.push(`ゆれ ${Math.round(info.heldSpan)}¢`);
    if (!info.still) parts.push('止まらずに離しました');
  }
  // 途中で一度止まって判定が出ていた時だけ、メーター表示ならどう出たかを添える
  if (mode === 'ear' && info.live && info.live !== info.final) {
    parts.push(`メーターなら「${RESULT_WORD[info.live]}」`);
  }
  return parts.join(' ／ ');
}

// 直近の試行のまとめ。entries: [{kind, error}]（error = 見せた音程 − 目標）
function summaryText(entries) {
  if (!entries.length) return '';
  const count = (k) => entries.filter((e) => e.kind === k).length;
  const mean = entries.reduce((s, e) => s + e.error, 0) / entries.length;
  const bias = Math.abs(mean) <= CONFIG.biasSmallCents ? 'ほぼ中央' : mean < 0 ? '低め' : '高め';
  return `直近${entries.length}回　◯${count('ok')} 低い${count('shallow')} 高い${count('over')}`
    + `　ずれの平均 ${formatCents(mean)}（${bias}）`;
}

// 課題の一行: 「3弦 12フレット　G4 → A4（1音）」
function taskText(string, fret, target) {
  const midi = baseMidi(string, fret);
  return `${string.label} ${fret}フレット　${noteName(midi)} → ${noteName(midi + target.cents / 100)}（${target.label}）`;
}

// ---------- 音の設計値 ----------
// IEC の A特性（1kHz で 1 になる倍率）
function aWeight(f) {
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2)
    / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * Math.pow(10, 2.0 / 20);
}

const decayRate = (f) => CONFIG.decayBase + CONFIG.decayPerKHz * f / 1000;

// 1音の設計: 倍音の強さ、束ごとの減衰、音量。弦を弾く位置とピックアップの位置で倍音が決まる
function designNote(string, fret) {
  const c = CONFIG, f0 = baseHz(string, fret);
  const L = c.scaleMm / Math.pow(2, fret / 12);
  const n = Math.max(1, Math.min(c.maxPartials, Math.floor(c.maxPartialHz / f0)));
  const amp = new Float64Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const r = (k * f0) / c.pickupResHz;
    const pickup = 1 / Math.sqrt((1 - r * r) ** 2 + (r / c.pickupQ) ** 2);
    amp[k] = (1 / k) * Math.sin(k * Math.PI * c.pluckMm / L) * Math.sin(k * Math.PI * c.pickupMm / L) * pickup;
  }
  const groupOf = (k) => { const g = c.groupEnds.findIndex((end) => k <= end); return g < 0 ? c.groupEnds.length : g; };
  const groups = Array.from({ length: c.groupEnds.length + 1 }, () => ({ harmonics: [], num: 0, den: 0 }));
  for (let k = 1; k <= n; k++) {
    const g = groups[groupOf(k)];
    g.harmonics.push(k); g.num += amp[k] ** 2 * decayRate(k * f0); g.den += amp[k] ** 2;
  }
  let rmsA2 = 0;
  for (let k = 1; k <= n; k++) rmsA2 += (amp[k] * aWeight(k * f0)) ** 2 / 2;
  // 1周期のピーク（全倍音が同じ位相で始まる）
  let peak = 0;
  for (let i = 0; i < c.peakScanSteps; i++) {
    let x = 0;
    for (let k = 1; k <= n; k++) x += amp[k] * Math.sin((2 * Math.PI * k * i) / c.peakScanSteps);
    peak = Math.max(peak, Math.abs(x));
  }
  const gain = Math.min(c.targetRmsA / Math.sqrt(rmsA2), c.notePeakMax / peak);
  return {
    f0, partials: n, amp, gain, peak: peak * gain, rmsA: Math.sqrt(rmsA2) * gain,
    groups: groups.filter((g) => g.den > 0).map((g) => ({ harmonics: g.harmonics, rate: g.num / g.den })),
  };
}

// 出力の安全弁（WaveShaper 用）。入力は ±headroom を ±1 に縮めて渡す。knee までは入力そのまま、そこから先は tanh で丸め、出力は 1.0 未満
function makeLimiterCurve(knee, points, headroom) {
  const out = new Float32Array(points), room = 1 - knee;
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * headroom, a = Math.abs(x);
    out[i] = Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG, clamp, midiToHz, findByKey, openHz, baseHz, baseMidi, noteName, median, formatCents, readSettings,
    strainAtPitch, bendCents, bendMm, spacingMm, pxPerMmWanted, pxPerMmFor, centsPerPx, restYFor, travelRoomPx, BendJudge, primaryResult,
    resultText, reviewText, summaryText, taskText, aWeight, decayRate, designNote, makeLimiterCurve,
  };
}

// ============================================================
// オーディオ
// ============================================================
// このブラウザで音を作れるか（古い Safari には ConstantSourceNode がない）
function audioSupported(ctx) {
  return typeof ctx.createConstantSource === 'function' && typeof ctx.createPeriodicWave === 'function';
}

// ctx は AudioContext でも OfflineAudioContext でもよい。時刻はすべて引数で受ける（オフラインで計測できるように）
function createAudio(ctx) {
  const master = ctx.createGain();
  master.gain.value = CONFIG.masterGain;
  const shrink = ctx.createGain();           // 安全弁の曲線は ±1 の入力しか受けないので、±headroom を ±1 に縮めてから通す
  shrink.gain.value = 1 / CONFIG.limiterHeadroom;
  const limiter = ctx.createWaveShaper();
  limiter.curve = makeLimiterCurve(CONFIG.limiterKnee, CONFIG.limiterPoints, CONFIG.limiterHeadroom);
  master.connect(shrink);
  shrink.connect(limiter);
  limiter.connect(ctx.destination);

  // 弦・フレットごとの波形は一度作って使い回す
  const notes = new Map();
  function noteFor(string, fret) {
    const key = `${string.key}-${fret}`;
    if (!notes.has(key)) {
      const d = designNote(string, fret);
      d.waves = d.groups.map((g) => {
        const real = new Float32Array(d.partials + 1), imag = new Float32Array(d.partials + 1);
        for (const k of g.harmonics) imag[k] = d.amp[k];
        return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
      });
      notes.set(key, d);
    }
    return notes.get(key);
  }

  let voices = [];
  function startVoice(note, t0, cents) {
    const gate = ctx.createGain();          // 消音用。ほかの自動化と混ざらないよう、束の包絡とは別にする
    gate.gain.value = 1;
    gate.connect(master);
    const bend = ctx.createConstantSource();
    bend.offset.value = cents;
    const oscs = note.groups.map((g, i) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(note.waves[i]);
      osc.frequency.value = note.f0;
      bend.connect(osc.detune);
      const env = ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(note.gain, t0 + CONFIG.attackS);
      env.gain.setTargetAtTime(0, t0 + CONFIG.attackS, 1 / g.rate);
      osc.connect(env);
      env.connect(gate);
      osc.start(t0);
      return osc;
    });
    bend.start(t0);
    const voice = { gate, bend, oscs, t0, sentCents: cents, muteAt: undefined };
    oscs[0].onended = () => {
      gate.disconnect();
      voices = voices.filter((v) => v !== voice);
    };
    for (const n of [...oscs, bend]) n.stop(t0 + CONFIG.voiceMaxS);
    voices.push(voice);
    return voice;
  }

  // when の時点から消す。先の時刻に消す予約が入っている音でも、それより早く消し直せる
  function muteVoice(voice, when, tau) {
    // まだ十分先にしか鳴り始めない音は、鳴らさない（ゲートを閉じておく）。
    // 鳴っている音と、もうすぐ鳴り始める音は、音声側から見て必ず未来になる時刻からなめらかに消す
    const unstarted = when <= voice.t0 - CONFIG.fadeLeadS;
    const start = unstarted ? when : Math.max(when, ctx.currentTime + CONFIG.fadeLeadS);
    const from = Math.max(start, voice.t0);
    if (voice.muteAt !== undefined && voice.muteAt <= from) return;
    voice.muteAt = from;
    voice.gate.gain.cancelScheduledValues(start);
    if (unstarted) voice.gate.gain.setValueAtTime(0, start);          // まだ鳴り始めていない音は鳴らさない
    else {
      voice.gate.gain.setValueAtTime(1, start);
      voice.gate.gain.setTargetAtTime(0, start, tau);
    }
    const stopAt = from + tau * CONFIG.muteStopTaus;
    for (const n of [...voice.oscs, voice.bend]) {
      try { n.stop(stopAt); } catch (e) { /* 止める時刻を決め直せない環境では、最長時間で止まる */ }
    }
  }

  let playing = null;                       // 指で鳴らしている音
  return {
    ctx,
    noteFor,
    // 弦を弾く。鳴っている音はすべて素早く消す
    pluck(string, fret, t) {
      const note = noteFor(string, fret);
      for (const v of voices) muteVoice(v, t, CONFIG.replaceTau);
      playing = startVoice(note, t, 0);
    },
    // 音程（セント）を送る。変化が小さい時は送らない
    setBend(cents, t) {
      if (!playing || playing.muteAt !== undefined) return;
      if (Math.abs(cents - playing.sentCents) < CONFIG.bendSendMinCents) return;
      playing.sentCents = cents;
      playing.bend.offset.setTargetAtTime(cents, Math.max(t, playing.t0), CONFIG.bendTau);
    },
    mute(t) {
      for (const v of voices) muteVoice(v, t, CONFIG.muteTau);
      playing = null;
    },
    // 2つの高さを続けて鳴らす（お手本: 0 → 目標）。各音の開始時刻を返す
    playPair(string, fret, firstCents, secondCents, t) {
      const note = noteFor(string, fret);
      for (const v of voices) muteVoice(v, t, CONFIG.replaceTau);
      playing = null;
      const t1 = t + CONFIG.refLeadS;
      const t2 = t1 + CONFIG.refBaseS + CONFIG.refGapS;
      const end = t2 + CONFIG.refTargetS;
      muteVoice(startVoice(note, t1, firstCents), t1 + CONFIG.refBaseS, CONFIG.muteTau);
      muteVoice(startVoice(note, t2, secondCents), end, CONFIG.muteTau);
      return { first: t1, second: t2, end };
    },
    running() { return ctx.state === 'running'; },
    resume() {
      if (ctx.state !== 'running' && ctx.resume) ctx.resume().catch(() => {});
    },
    voiceCount() { return voices.length; },
  };
}

// ============================================================
// 自己診断 (?selftest=1): 本番と同じ音の回路をオフラインで鳴らして、数字で確かめる
// ============================================================
async function runSelfTest(log) {
  const T = CONFIG.selftest, sr = T.sampleRate;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const string = findByKey(CONFIG.strings, CONFIG.stringDefault), fret = CONFIG.fretDefault;
  const render = async (seconds, script) => {
    const off = new OAC(1, Math.floor(sr * seconds), sr);
    script(createAudio(off), off);
    return (await off.startRendering()).getChannelData(0);
  };
  const peakOf = (d, a = 0, b = d.length) => { let p = 0; for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); return p; };
  const rmsOf = (d, a, b) => { let e = 0; for (let i = a; i < b; i++) e += d[i] * d[i]; return Math.sqrt(e / (b - a)); };
  // 基本周波数: 自己相関のピークを放物線で補間
  const pitchOf = (d, from, len, guessHz) => {
    const corr = (lag) => { let c = 0; for (let i = from; i < from + len; i++) c += d[i] * d[i + lag]; return c; };
    const mid = Math.round(sr / guessHz);
    let best = mid, bestV = -Infinity;
    for (let lag = mid - T.lagSearch; lag <= mid + T.lagSearch; lag++) { const v = corr(lag); if (v > bestV) { bestV = v; best = lag; } }
    const a = corr(best - 1), b = bestV, c = corr(best + 1);
    return sr / (best + (0.5 * (a - c)) / (a - 2 * b + c));
  };
  // 設計どおりに減衰した時の実効値（from〜to 秒の平均）
  const designRms = (design, from, to) => {
    let e = 0;
    for (const g of design.groups) {
      let p = 0;
      for (const k of g.harmonics) p += (design.amp[k] * design.gain * CONFIG.masterGain) ** 2 / 2;
      const r = 2 * g.rate;
      e += p * (Math.exp(-r * (from - CONFIG.attackS)) - Math.exp(-r * (to - CONFIG.attackS))) / (r * (to - from));
    }
    return Math.sqrt(e);
  };
  const results = [];
  const check = (name, ok, detail) => { results.push(ok); log(`${ok ? '合格' : '不合格'}  ${name}  ${detail}`); };

  // 1. 波形の正規化なしが効いているか
  {
    const off = new OAC(1, Math.floor(sr * T.normRenderS), sr);
    const imag = new Float32Array(2); imag[1] = T.normPeak;
    const osc = off.createOscillator();
    osc.setPeriodicWave(off.createPeriodicWave(new Float32Array(2), imag, { disableNormalization: true }));
    osc.frequency.value = CONFIG.a4Hz; osc.connect(off.destination); osc.start(0);
    const p = peakOf((await off.startRendering()).getChannelData(0));
    check('波形の大きさ', Math.abs(p - T.normPeak) <= T.normTol, `ピーク ${p.toFixed(4)}（基準 ${T.normPeak}）`);
  }
  // 2. 音程: 0 / 目標ごと
  for (const cents of [0, ...CONFIG.targets.map((t) => t.cents)]) {
    const d = await render(T.pitchFromS + T.pitchLenS + T.pitchTailS, (a) => { a.pluck(string, fret, 0); a.setBend(cents, 0); });
    const want = baseHz(string, fret) * Math.pow(2, cents / 1200);
    const got = pitchOf(d, Math.floor(T.pitchFromS * sr), Math.floor(T.pitchLenS * sr), want);
    const err = 1200 * Math.log2(got / want);
    check(`音程 ${formatCents(cents)}`, Math.abs(err) <= T.pitchTolCents, `${got.toFixed(2)}Hz（基準 ${want.toFixed(2)}Hz、誤差 ${err.toFixed(2)}¢）`);
  }
  // 3. 音量と消音
  {
    const d = await render(T.eventAtS + T.mutedToS + T.fadeTailS, (a) => { a.pluck(string, fret, 0); a.mute(T.eventAtS); });
    const early = rmsOf(d, Math.floor(T.earlyFromS * sr), Math.floor(T.earlyToS * sr));
    const db = 20 * Math.log10(early / designRms(designNote(string, fret), T.earlyFromS, T.earlyToS));
    check('鳴らし始めの音量', Math.abs(db) <= T.levelDbTol, `設計値との差 ${db.toFixed(2)}dB`);
    const before = rmsOf(d, Math.floor((T.eventAtS - T.fadeTailS) * sr), Math.floor(T.eventAtS * sr));
    const after = rmsOf(d, Math.floor((T.eventAtS + T.mutedFromS) * sr), Math.floor((T.eventAtS + T.mutedToS) * sr));
    const mdb = 20 * Math.log10(after / before);
    check('消音', mdb <= T.mutedDb, `${Math.round(T.mutedFromS * 1000)}ms 後 ${mdb.toFixed(1)}dB（基準 ${T.mutedDb}dB 以下）`);
  }
  // 4. 最悪の操作でのピーク: お手本の途中で弾き直しを重ね、上限まで上げる
  {
    let worst = 0;
    for (const s of CONFIG.strings) for (const f of CONFIG.frets) {
      const bendFrom = T.eventAtS + T.replucks * T.repluckEveryS;
      const d = await render(bendFrom + T.bendSteps / T.bendRate + T.pitchLenS, (a) => {
        a.playPair(s, f, 0, CONFIG.maxBendCents, 0);
        for (let i = 0; i < T.replucks; i++) a.pluck(s, f, T.eventAtS + i * T.repluckEveryS);
        for (let i = 0; i <= T.bendSteps; i++) a.setBend((CONFIG.maxBendCents * i) / T.bendSteps, bendFrom + i / T.bendRate);
      });
      worst = Math.max(worst, peakOf(d));
    }
    check('ピーク', worst <= CONFIG.limiterKnee, `最大 ${worst.toFixed(3)}（基準 ${CONFIG.limiterKnee} 以下）`);
  }
  // 5. 減衰と、1音のピーク（全部の弦・フレット）
  {
    const d = await render(T.lateToS, (a) => { a.pluck(string, fret, 0); });
    const late = rmsOf(d, Math.floor(T.lateFromS * sr), Math.floor(T.lateToS * sr));
    const db = 20 * Math.log10(late / designRms(designNote(string, fret), T.lateFromS, T.lateToS));
    check('減衰', Math.abs(db) <= T.levelDbTol, `${T.lateFromS}秒後の音量 設計値との差 ${db.toFixed(2)}dB`);
    let worst = 0;
    for (const s of CONFIG.strings) for (const f of CONFIG.frets) {
      const p = peakOf(await render(T.notePeakS, (a) => { a.pluck(s, f, 0); }));
      const e = 20 * Math.log10(p / (designNote(s, f).peak * CONFIG.masterGain));
      if (Math.abs(e) > Math.abs(worst)) worst = e;
    }
    check('1音のピーク', Math.abs(worst) <= T.notePeakDbTol, `設計値との差 最大 ${worst.toFixed(2)}dB`);
  }
  // 6. 消音・弾き直しの消え方が設計どおりか（段差がないか）と、消した音の後片づけ
  {
    const len = T.eventAtS + 1 / baseHz(string, fret) + CONFIG.muteTau * CONFIG.muteStopTaus + T.fadeTailS;
    const alone = await render(len, (a) => { a.pluck(string, fret, 0); });
    let muteErr = 0, replErr = 0, left = 0;
    for (let p = 0; p < T.eventPhases; p++) {
      const at = T.eventAtS + p / T.eventPhases / baseHz(string, fret);
      const from = Math.ceil(at * sr);
      let audio;
      const muted = await render(len, (a) => { audio = a; a.pluck(string, fret, 0); a.mute(at); });
      for (const until = performance.now() + T.cleanupWaitMs; audio.voiceCount() > 0 && performance.now() < until;) {
        await new Promise((done) => setTimeout(done, 0));   // 発振が止まった通知 (ended) を待つ
      }
      left = Math.max(left, audio.voiceCount());
      const second = await render(len, (a) => { a.pluck(string, fret, at); });
      const both = await render(len, (a) => { a.pluck(string, fret, 0); a.pluck(string, fret, at); });
      for (let i = 0; i < alone.length; i++) {
        const dt = i / sr - at;
        const gm = i < from ? 1 : Math.exp(-dt / CONFIG.muteTau);
        const gr = i < from ? 1 : dt < CONFIG.replaceTau * CONFIG.muteStopTaus ? Math.exp(-dt / CONFIG.replaceTau) : 0;
        muteErr = Math.max(muteErr, Math.abs(muted[i] - alone[i] * (dt < CONFIG.muteTau * CONFIG.muteStopTaus ? gm : 0)));
        replErr = Math.max(replErr, Math.abs(both[i] - (alone[i] * gr + second[i])));
      }
    }
    check('消音のなめらかさ', muteErr <= T.fadeErrMax, `設計との差 最大 ${muteErr.toFixed(4)}（基準 ${T.fadeErrMax} 以下）`);
    check('弾き直しのなめらかさ', replErr <= T.fadeErrMax, `設計との差 最大 ${replErr.toFixed(4)}（基準 ${T.fadeErrMax} 以下）`);
    check('消した音の後片づけ', left === 0, `残っている音 ${left}`);
  }
  log('（オフラインの計算で確かめています。実際に鳴らした時の遅れや途切れは、この診断ではわかりません）');
  log(results.every(Boolean) ? '\nすべて合格' : '\n不合格があります');
  return results.every(Boolean);
}

// ============================================================
// UI
// ============================================================
function initApp() {
  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const el = {
    app: $('app'), board: $('board'), boardStatic: $('boardStatic'), boardLive: $('boardLive'), boardTop: $('boardTop'),
    hit: $('hit'), miss: $('miss'),
    noteLine: $('noteLine'), cents: $('cents'), liveWord: $('liveWord'), badge: $('badge'),
    meter: $('meter'), meterBand: $('meterBand'), meterBar: $('meterBar'), meterTicks: $('meterTicks'),
    resultLine: $('resultLine'), reviewLine: $('reviewLine'),
    history: $('history'), summary: $('summary'),
    targetSeg: $('targetSeg'), modeSeg: $('modeSeg'), stringSel: $('stringSel'), fretSel: $('fretSel'),
    refBtn: $('refBtn'),
    helpBtn: $('helpBtn'), help: $('help'), helpTitle: $('helpTitle'), helpClose: $('helpClose'), helpCloseTop: $('helpCloseTop'),
    overlay: $('startOverlay'), startBtn: $('startBtn'), startMsg: $('startMsg'),
    debug: $('debug'), selftest: $('selftest'),
  };
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get('debug') === '1', SELFTEST = params.get('selftest') === '1';
  const TEXT = {
    lowBoard: '画面が低すぎます。横向きか高さを広げて',
    missed: '弦（光っている線）を押さえてください',
    tapOnly: '弦を上へずらしてください',
    tapOnlyDown: '弦を下へずらしてください',
    resumed: '音を再開しました。もう一度どうぞ',
    noSound: 'このブラウザでは音を鳴らせません',
    earMode: '耳だけ: 結果は指を離したあとに出ます',
    meterMode: 'メーターを表示します',
    nudge: '慣れたら「耳だけ」で',
    hint: '↑ 弦を押さえて、上へずらす',
    hintDown: '↓ 弦を押さえて、下へずらす',
    boardLabel: (down) => `指板。弦を押さえて上にずらすと音が上がります（${down}弦は下へ）。キーボードでは Space で押さえ、上下の矢印でずらします`,
    unsupported: 'このブラウザは音の合成に対応していないため、音が出ません。',
  };

  const loadSettings = () => {
    try { return JSON.parse(localStorage.getItem(CONFIG.storageKey)); } catch (e) { return null; }
  };
  const state = {
    ...readSettings(loadSettings()),
    activeId: null,               // 押さえているポインタ（最初の1本だけ）。キーボードは 'key'
    downY: 0, x: 0, y: 0,
    keyMm: 0,                     // キーボードでの移動量
    cents: 0, dPx: 0,
    shown: false,                 // この試行の判定をもう見せたか
    attemptMode: CONFIG.modeDefault,   // 試行を始めた時のモード
    playedDir: { up: false, down: false },   // 向きごとに一度でも弾いたか（最初の案内を消す）
    shownTask: null,              // いま見せている結果の課題（弦・フレット・目標）。同じ課題の間は結果を残す
    shownCents: null,             // いま見せている結果の高さ（離したあとメーターに残す）
    entries: [],                  // 履歴 [{kind, error}]（historyLen 件まで）
    okInMeter: 0, nudged: false,
    base: { text: '', kind: '' }, // 読み取りの行に残しておく文（判定の一文）
    tempUntil: 0,                 // 一時的な案内を出している間の期限
    badgeUntil: 0,
    lowBoard: false,
    refTimers: [], autoRefTimer: 0,
  };
  const saveSettings = () => {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        target: state.target, mode: state.mode, string: state.string, fret: state.fret,
      }));
    } catch (e) { /* private mode 等では保存しない */ }
  };
  const target = () => findByKey(CONFIG.targets, state.target);
  const string = () => findByKey(CONFIG.strings, state.string);

  const judge = new BendJudge(CONFIG);
  judge.setTarget(target().cents);
  let audio = null;
  const now = () => audio.ctx.currentTime;
  let lastTs = 0;

  // ---------- 読み取りの行（判定の一文 / 一時的な案内 / 再生中のラベル） ----------
  const paintLine = (text, kind) => {
    el.resultLine.textContent = text;
    el.resultLine.dataset.kind = kind;
  };
  // 何も出すものがない時の文。盤が低すぎる間は、その案内を出し続ける
  const idleText = () => (state.lowBoard ? TEXT.lowBoard : '');
  function restoreLine() {
    state.tempUntil = 0;
    paintLine(state.base.text || idleText(), state.base.text ? state.base.kind : '');
  }
  function setBase(text, kind) {
    state.base = { text, kind };
    restoreLine();
  }
  // 一時的な案内。時間がたつと、残しておいた文に戻る
  function flash(text) {
    paintLine(text, '');
    state.tempUntil = performance.now() + CONFIG.hintMs;
  }
  // 再生中のラベル。再生が終わるまで出しておく
  function showPlayLabel(text) {
    paintLine(text, '');
    state.tempUntil = 0;
  }
  function clearResult() {
    el.badge.textContent = '';
    el.badge.dataset.kind = '';
    el.reviewLine.textContent = '';
    state.shownTask = null;
    state.shownCents = null;
    setBase('', '');
  }

  // ---------- 盤 ----------
  // dir: 指が進む向き（+1 = 画面の上へ、-1 = 下へ）
  const geo = { w: 0, h: 0, restY: 0, dir: 1, left: 0, right: 0, pxPerMm: CONFIG.pxPerMm, gapPx: 0, capPx: 0, xRef: 0 };
  const meter = { max: CONFIG.meterMaxCents };
  const svgEl = (name, attrs, parent) => {
    const n = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent.appendChild(n);
    return n;
  };
  // フレット n の金属の位置（ナットからの距離を、弦の間隔と同じ縮尺で）。押さえる位置（金属のすぐ手前）が盤の中央に来る
  const fretDistMm = (n) => CONFIG.scaleMm * (1 - Math.pow(2, -n / 12));
  const wireX = (n) => geo.xRef + fretDistMm(n) * geo.pxPerMm;
  const fretX = (fret) => (wireX(fret - 1) + wireX(fret)) / 2;                    // 升の中央（番号・ポジションマーク）
  const pressBehindMm = (fret) => Math.min(CONFIG.pressBehindMm, (fretDistMm(fret) - fretDistMm(fret - 1)) / 2);
  const pressX = (fret) => wireX(fret) - pressBehindMm(fret) * geo.pxPerMm;      // 押さえる位置
  // 弦 n の高さ（弾く弦を基準に、低い弦ほど上）
  const stringY = (n) => geo.restY - (n - string().number) * geo.gapPx;

  function layoutBoard() {
    const r = el.board.getBoundingClientRect();
    geo.w = r.width; geo.h = r.height;
    el.board.setAttribute('viewBox', `0 0 ${Math.max(1, geo.w)} ${Math.max(1, geo.h)}`);
    const c = CONFIG, s = string();
    geo.restY = restYFor(geo.h, s, state.fret);
    geo.dir = s.bendDown ? -1 : 1;
    geo.left = c.edgeInsetPx; geo.right = geo.w - c.edgeInsetPx;
    geo.pxPerMm = pxPerMmFor(travelRoomPx(geo.h, s, state.fret), s, state.fret);
    geo.gapPx = spacingMm(state.fret) * geo.pxPerMm;
    geo.capPx = bendMm(c.maxBendCents, s, state.fret) * geo.pxPerMm;
    geo.xRef = geo.w / 2 - (fretDistMm(state.fret) - pressBehindMm(state.fret)) * geo.pxPerMm;

    const g = el.boardStatic;
    g.textContent = '';
    const lastFret = c.frets[c.frets.length - 1];
    // 指板（木）。外側の弦の先は、ふち（縁取り）とネックの側面
    svgEl('rect', { class: 'wood', x: 0, y: 0, width: geo.w, height: geo.h }, g);
    svgEl('rect', { class: 'wood-figure', x: 0, y: 0, width: geo.w, height: geo.h }, g);
    const topEdge = stringY(c.stringCount) - geo.gapPx * c.edgeBeyondGap;
    const bottomEdge = stringY(1) + geo.gapPx * c.edgeBeyondGap;
    if (topEdge > 0) {
      svgEl('rect', { class: 'neck-side', x: 0, y: 0, width: geo.w, height: topEdge }, g);
      svgEl('rect', { class: 'binding', x: 0, y: topEdge - c.bindingPx, width: geo.w, height: c.bindingPx }, g);
    }
    if (bottomEdge < geo.h) {
      svgEl('rect', { class: 'neck-side', x: 0, y: bottomEdge, width: geo.w, height: geo.h - bottomEdge }, g);
      svgEl('rect', { class: 'binding', x: 0, y: bottomEdge, width: geo.w, height: c.bindingPx }, g);
    }
    const woodTop = Math.max(0, topEdge), woodBottom = Math.min(geo.h, bottomEdge);
    // ナットより手前はヘッド、最終フレットの先の指板の端より向こうはボディ
    const nutX = wireX(0), endX = wireX(lastFret) + c.boardEndMm * geo.pxPerMm;
    if (nutX > 0) {
      svgEl('rect', { class: 'head', x: 0, y: 0, width: Math.min(geo.w, nutX), height: geo.h }, g);
      svgEl('rect', { class: 'nut', x: nutX - c.nutMm * geo.pxPerMm, y: woodTop, width: c.nutMm * geo.pxPerMm, height: woodBottom - woodTop }, g);
    }
    if (endX < geo.w) svgEl('rect', { class: 'body', x: Math.max(0, endX), y: 0, width: geo.w - Math.max(0, endX), height: geo.h }, g);
    // フレット（金属の棒と、両脇の溝）
    for (const n of c.frets) {
      const x = wireX(n);
      if (x < -c.fretWirePx || x > geo.w + c.fretWirePx) continue;
      svgEl('rect', { class: 'fret-groove', x: x - c.fretWirePx / 2 - c.fretGroovePx, y: woodTop, width: c.fretWirePx + 2 * c.fretGroovePx, height: woodBottom - woodTop }, g);
      svgEl('rect', { class: 'fret-wire', x: x - c.fretWirePx / 2, y: woodTop, width: c.fretWirePx, height: woodBottom - woodTop }, g);
    }
    // ポジションマーク（実物と同じ位置: 単発は3〜4弦の間、12フレットは1〜2弦と5〜6弦の間）
    // フレット番号の帯にかかるものは描かない（番号の下から半分のぞいてしまう）
    const pearl = (x, y) => { if (y > woodTop && y < woodBottom && y + c.inlayRadiusPx < geo.h - c.fretStripPx) svgEl('circle', { class: 'inlay', cx: x, cy: y, r: c.inlayRadiusPx }, g); };
    for (const n of c.frets) {
      const x = fretX(n);
      if (x < 0 || x > geo.w) continue;
      if (c.inlayFrets.includes(n)) pearl(x, (stringY(3) + stringY(4)) / 2);
      if (c.inlayDoubleFrets.includes(n)) { pearl(x, (stringY(1) + stringY(2)) / 2); pearl(x, (stringY(5) + stringY(6)) / 2); }
    }
    // フレット番号の帯（下端）。弦より上に描く（弦が番号を横切らない）。番号は升の見えている部分の中央に置く（拡大した低いフレットは升が盤より広い）
    const top = el.boardTop;
    top.textContent = '';
    svgEl('rect', { class: 'fret-strip', x: 0, y: geo.h - c.fretStripPx, width: geo.w, height: c.fretStripPx }, top);
    for (const n of c.frets) {
      const x0 = Math.max(wireX(n - 1), geo.left), x1 = Math.min(wireX(n), geo.right);
      if (x1 - x0 < c.fretNumFontPx * c.fretNumMinCellEm) continue;
      const t = svgEl('text', { class: 'fret-num' + (n === state.fret ? ' on' : ''), x: (x0 + x1) / 2, y: geo.h - c.fretStripPx / 2, 'font-size': c.fretNumFontPx }, top);
      t.textContent = String(n);
    }
    // 当たり判定: 弾く弦のまわり。指が進む側は hitHalfPx まで、反対側は盤の端まで（そちらに別の弦が入っている時は、その弦との中間まで）。
    // 左右の端は避ける。外した所（miss）は盤全体で、hit がその上に載る
    const edge = clamp(geo.restY - geo.dir * c.hitHalfPx, 0, geo.h);
    const behindN = s.number - geo.dir;
    const behindOnBoard = behindN >= 1 && behindN <= c.stringCount && (geo.dir > 0 ? stringY(behindN) <= geo.h : stringY(behindN) >= 0);
    const behindEdge = behindOnBoard ? geo.restY + geo.dir * geo.gapPx / 2 : geo.dir > 0 ? geo.h : 0;
    const hitRange = geo.dir > 0 ? [edge, behindEdge] : [behindEdge, edge];
    for (const [node, [y0, y1]] of [[el.miss, [0, geo.h]], [el.hit, hitRange]]) {
      node.setAttribute('x', geo.left); node.setAttribute('width', Math.max(0, geo.right - geo.left));
      node.setAttribute('y', y0); node.setAttribute('height', Math.max(0, y1 - y0));
    }
    drawnBoard = '';
    // 指 1px あたりの音程の変化が大きすぎる（盤が低い）間は、案内を出し続ける
    state.lowBoard = centsPerPx(judge.target, string(), state.fret, geo.pxPerMm) > CONFIG.centsPerPxMax;
    if (!state.tempUntil && !state.refTimers.length) restoreLine();
  }

  // 弦（動く部分）。弾く弦は指の位置で折れ、通り過ぎた隣の弦は一緒に押される
  let drawnBoard = '';
  function renderBoard() {
    const c = CONFIG;
    const active = state.activeId !== null;
    const px = active ? clamp(state.x - el.board.getBoundingClientRect().left, geo.left, geo.right) : pressX(state.fret);
    const fingerY = geo.restY - geo.dir * state.dPx;
    const inBand = active && state.attemptMode === 'meter'
      && Math.abs(state.cents - judge.target) <= judge.tolerance;
    const s = string();
    const down = s.bendDown === true;
    const seen = state.playedDir[down ? 'down' : 'up'];
    const key = [active, Math.round(px), fingerY.toFixed(1), inBand, state.string, state.fret, seen].join();
    if (key === drawnBoard) return;
    drawnBoard = key;
    const g = el.boardLive;
    g.textContent = '';
    // 弦1本 = 影・本体・光の3本の線
    const drawString = (number, points, isActive) => {
      const width = c.stringGaugePx[number] + (isActive ? c.activeExtraPx : 0);
      const kind = isActive ? 'active' : number >= c.woundFrom ? 'wound' : 'plain';
      if (isActive) svgEl('polyline', { class: 'string glow', points, 'stroke-width': width + c.activeGlowPx }, g);
      svgEl('polyline', { class: 'string shadow', points, 'stroke-width': width + c.stringShadowExtraPx, transform: `translate(0 ${c.stringShadowDyPx})` }, g);
      svgEl('polyline', { class: `string ${kind}`, points, 'stroke-width': width }, g);
      svgEl('polyline', { class: 'string highlight', points, 'stroke-width': Math.max(c.stringHighlightMinPx, width * c.stringHighlightRatio), transform: `translate(0 ${c.stringHighlightDyPx})` }, g);
    };
    // ほかの弦（低い弦ほど上）。指が進む先にある弦は、通り過ぎたら一緒に押される
    for (let n = c.stringCount; n >= 1; n--) {
      if (n === s.number) continue;
      const y = stringY(n);
      if (y < -geo.gapPx || y > geo.h + geo.gapPx) continue;
      const k = Math.abs(n - s.number);
      const ahead = down ? n < s.number : n > s.number;
      const pushedY = fingerY - geo.dir * k * c.pushedGapPx;
      const passed = active && ahead && (down ? pushedY > y : pushedY < y);
      const pts = passed
        ? `${0},${y} ${px},${pushedY} ${geo.w},${y}`
        : `${0},${y} ${geo.w},${y}`;
      drawString(n, pts, false);
      if (y < 0 || y + c.labelFontPx + c.labelPadPx > geo.h - c.fretStripPx) continue;   // 盤の外やフレット番号の帯にかかる弦にはラベルを付けない
      const t = svgEl('text', { class: 'string-label', x: geo.left, y: y + c.labelFontPx + c.labelPadPx, 'font-size': c.labelFontPx }, g);
      t.textContent = `${n}弦`;
    }
    svgEl('line', { class: 'rest-line', x1: 0, x2: geo.w, y1: geo.restY, y2: geo.restY }, g);
    drawString(s.number, `${0},${geo.restY} ${px},${fingerY} ${geo.w},${geo.restY}`, true);
    const label = svgEl('text', { class: 'string-label on', x: geo.left, y: geo.restY + c.labelFontPx + c.labelPadPx, 'font-size': c.labelFontPx }, g);
    label.textContent = s.label;
    if (active) {
      svgEl('circle', { class: 'dot-halo' + (inBand ? ' in-band' : ''), cx: px, cy: fingerY, r: c.touchDotRadiusPx * c.touchHaloRatio }, g);
      svgEl('circle', { class: 'dot' + (inBand ? ' in-band' : ''), cx: px, cy: fingerY, r: c.touchDotRadiusPx }, g);
    } else {
      // 押さえる場所の目印（光る◎）と、最初だけの案内
      svgEl('circle', { class: 'press-glow', cx: px, cy: geo.restY, r: c.touchDotRadiusPx * c.pressGlowRatio }, g);
      svgEl('circle', { class: 'press-ring', cx: px, cy: geo.restY, r: c.touchDotRadiusPx }, g);
      svgEl('circle', { class: 'press-core', cx: px, cy: geo.restY, r: c.touchDotRadiusPx * c.pressCoreRatio }, g);
      if (!seen) {
        const y = down ? geo.restY + c.hitHalfPx + c.hintFontPx + c.labelPadPx : geo.restY - c.hitHalfPx - c.labelFontPx;
        const hint = svgEl('text', { class: 'board-hint', x: geo.w / 2, y, 'font-size': c.hintFontPx }, g);
        hint.textContent = down ? TEXT.hintDown : TEXT.hint;
      }
    }
  }

  // ---------- 読み取り表示 ----------
  function renderTask() {
    el.noteLine.textContent = taskText(string(), state.fret, target());
    // 目標の帯がメーターに収まらない時（1音半）だけ、目盛りを広げる
    meter.max = judge.target + judge.tolerance >= CONFIG.meterMaxCents ? CONFIG.meterMaxCentsHigh : CONFIG.meterMaxCents;
    const pct = (c) => `${clamp((c / meter.max) * 100, 0, 100)}%`;
    el.meterBand.style.left = pct(judge.target - judge.tolerance);
    el.meterBand.style.width = `${((2 * judge.tolerance) / meter.max) * 100}%`;
    el.meterTicks.textContent = '';
    for (const c of CONFIG.meterTicks) {
      if (c > meter.max) continue;
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.left = pct(c);
      tick.textContent = c ? `+${c}` : '0';
      el.meterTicks.appendChild(tick);
    }
  }

  let drawnLive = '';
  // 押さえている間は、メーター表示なら今の高さ。離したあとは（耳だけでも）判定した高さをメーターに残す
  function renderLive(ts) {
    const active = state.activeId !== null;
    const shown = !active && state.shownCents !== null;
    const meterOn = active ? state.attemptMode === 'meter' : state.mode === 'meter' || shown;
    const cents = active ? state.cents : shown ? state.shownCents : 0;
    let num = '—', word = '', kind = '';
    if ((active && meterOn) || shown) {
      const lo = judge.target - judge.tolerance, hi = judge.target + judge.tolerance;
      num = formatCents(cents);
      if (cents < lo) { word = active ? '▽ 低い' : ''; kind = 'under'; }
      else if (cents > hi) { word = active ? '△ 高い' : ''; kind = 'over'; }
      else { word = active ? '● いま目標' : ''; kind = 'ok'; }
    } else if (active) {
      num = '耳で'; word = '合わせる';
    }
    const bar = meterOn && (active || shown) ? clamp((cents / meter.max) * 100, 0, 100) : 0;
    const beyond = meterOn && (active || shown) && cents > meter.max;
    const badgeOn = ts < state.badgeUntil;
    const key = [num, word, kind, meterOn, Math.round(bar * 10), beyond, badgeOn].join();
    if (key === drawnLive) return;
    drawnLive = key;
    el.cents.textContent = num;
    el.cents.classList.toggle('small', active && !meterOn);
    el.liveWord.textContent = word;
    el.liveWord.dataset.kind = kind;
    el.meter.classList.toggle('off', !meterOn);
    el.meter.classList.toggle('beyond', beyond);      // 目盛りの外まで上がった時は、右端に ▶ を出す
    el.meterBar.style.width = `${bar}%`;
    el.meterBar.classList.toggle('in-band', kind === 'ok');
    el.badge.classList.toggle('fresh', badgeOn);
  }

  function renderHistory() {
    el.history.textContent = '';
    for (let i = 0; i < CONFIG.historyLen; i++) {
      const e = state.entries[state.entries.length - CONFIG.historyLen + i];
      const kind = e ? e.kind : 'empty';
      const svg = svgEl('svg', { viewBox: CONFIG.historyViewBox, class: `hist ${kind}`, 'aria-hidden': 'true', focusable: 'false' }, el.history);
      svgEl('path', { d: CONFIG.historyShapes[kind] }, svg);
    }
    const words = state.entries.map((e) => RESULT_WORD[e.kind]);
    el.history.setAttribute('aria-label', words.length ? `判定の履歴: ${words.join('、')}` : '判定の履歴（まだありません）');
    el.summary.textContent = summaryText(state.entries);
  }

  // 判定を見せる（1試行につき履歴は1回）
  function showResult(info, mode, atRelease) {
    const res = primaryResult(info, mode);
    el.badge.textContent = RESULT_WORD[res.kind];
    el.badge.dataset.kind = res.kind;
    setBase(resultText(info, mode), res.kind);
    el.reviewLine.textContent = atRelease ? reviewText(info, mode) : '';
    if (!state.shown) {
      state.shown = true;
      state.badgeUntil = performance.now() + CONFIG.badgeMs;
      state.entries.push({ kind: res.kind, error: res.cents - info.target });
      if (state.entries.length > CONFIG.historyLen) state.entries.shift();
      if (mode === 'meter' && res.kind === 'ok') state.okInMeter++;
      renderHistory();
    }
    if (!atRelease) return;
    state.shownTask = { string: state.string, fret: state.fret, target: info.target };
    state.shownCents = res.cents;
    if (mode === 'meter' && !state.nudged && state.okInMeter >= CONFIG.nudgeAfterOk) {
      state.nudged = true;
      el.reviewLine.textContent += ` ／ ${TEXT.nudge}`;
    }
    if (DEBUG) (window.bendLog = window.bendLog || []).push({ ...info, mode, string: state.string, fret: state.fret });
  }

  // ---------- 試行 ----------
  function cancelRef() {
    for (const id of state.refTimers) clearTimeout(id);
    state.refTimers = [];
    clearTimeout(state.autoRefTimer);
  }

  // 指のいまの位置（キーボードなら移動量）から音程を求める。指が進む向きと逆や、上限より先は、絵も音程も動かさない
  function readBend() {
    const raw = state.activeId === 'key' ? state.keyMm * geo.pxPerMm : Math.max(0, geo.dir * (state.downY - state.y));
    state.dPx = Math.min(raw, geo.capPx);
    state.cents = Math.min(bendCents(state.dPx / geo.pxPerMm, string(), state.fret), CONFIG.maxBendCents);
  }

  function beginAttempt(id) {
    if (state.activeId !== null || !audio) return false;
    cancelRef();
    if (!audio.running()) {
      // 音が止まっている（電話・タブ切替のあと）。この操作で再開だけして、試行にはしない
      audio.resume();
      flash(TEXT.resumed);
      return false;
    }
    try {
      audio.pluck(string(), state.fret, now() + CONFIG.pluckLeadS);
    } catch (e) {
      flash(TEXT.noSound);
      return false;
    }
    clearResult();
    state.activeId = id;
    state.attemptMode = state.mode;
    state.shown = false;
    state.playedDir[geo.dir > 0 ? 'up' : 'down'] = true;
    state.dPx = 0; state.cents = 0; state.keyMm = 0;
    judge.start();
    return true;
  }

  function endAttempt(judged) {
    if (state.activeId === null) return;
    if (judged) {
      // 離した位置も判定に入れる（最後の描画のあとに動いたぶんを落とさない）
      readBend();
      judge.process({ cents: state.cents, dt: Math.max(0, performance.now() - lastTs) });
    }
    state.activeId = null;
    state.dPx = 0; state.cents = 0;
    if (audio) audio.mute(now());
    const info = judged ? judge.release() : null, liveCents = judge.liveCents;
    judge.cancel();
    if (info && info.attempted) showResult(info, state.attemptMode, true);
    else if (info) flash(string().bendDown ? TEXT.tapOnlyDown : TEXT.tapOnly);
    // 判定を見せたあとに打ち切られた（使い方を開いた・画面が変わった）: 印と文はそのままなので、高さもメーターに残す
    else if (state.shown) { state.shownTask = { string: state.string, fret: state.fret, target: judge.target }; state.shownCents = liveCents; }
  }

  el.hit.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (!beginAttempt(e.pointerId)) return;
    try { el.hit.setPointerCapture(e.pointerId); } catch (err) { /* 既に離れている */ }
    state.downY = e.clientY; state.x = e.clientX; state.y = e.clientY;
  });
  el.hit.addEventListener('pointermove', (e) => {
    if (e.pointerId !== state.activeId) return;
    state.x = e.clientX; state.y = e.clientY;
  });
  el.hit.addEventListener('pointerup', (e) => {
    if (audio) audio.resume();
    if (e.pointerId !== state.activeId) return;
    state.x = e.clientX; state.y = e.clientY;
    endAttempt(true);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    el.hit.addEventListener(type, (e) => { if (e.pointerId === state.activeId) endAttempt(false); });
  }
  el.miss.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.activeId === null) flash(TEXT.missed);
  });
  el.board.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => endAttempt(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endAttempt(false); });

  // ---------- キーボード: Space で押さえ、↑↓ で弦をずらす ----------
  // Space は Tab でフォーカスを移したコントロール上では通常どおり（ボタン操作）に譲る。
  // Tab で指板を選べば、また Space で押さえられる
  let keyboardNav = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') keyboardNav = true; }, true);
  window.addEventListener('pointerdown', () => { keyboardNav = false; }, true);
  const yieldsToControl = (t) =>
    keyboardNav && t instanceof Element && t.matches('button, input, select, textarea');
  const blocked = () => !el.overlay.hidden || !el.help.hidden;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || blocked()) return;
    if (e.code === 'Space') {
      if (yieldsToControl(e.target)) return;
      e.preventDefault();
      if (!e.repeat && beginAttempt('key')) state.x = el.board.getBoundingClientRect().left + pressX(state.fret);
      return;
    }
    if (state.activeId !== 'key') return;
    // ↑↓ は画面上で指を動かす向き。引き下げる弦では ↓ で上がる
    const step = { ArrowUp: CONFIG.keyStepMm, ArrowDown: -CONFIG.keyStepMm }[e.code];
    if (!step) return;
    e.preventDefault();
    state.keyMm = clamp(state.keyMm + geo.dir * step, 0, geo.capPx / geo.pxPerMm);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    if (state.activeId === 'key') { e.preventDefault(); endAttempt(true); }
  });

  // ---------- お手本 ----------
  function playPair(str, fret, first, second, labels) {
    if (!audio || state.activeId !== null) return;
    audio.resume();
    cancelRef();
    const t = now();
    let times;
    try {
      times = audio.playPair(str, fret, first, second, t);
    } catch (e) {
      flash(TEXT.noSound);
      return;
    }
    const at = (when, fn) => state.refTimers.push(setTimeout(fn, Math.max(0, (when - t) * 1000)));
    at(times.first, () => showPlayLabel(`♪ ${labels[0]}`));
    at(times.second, () => showPlayLabel(`♪ ${labels[1]}`));
    at(times.end, () => { state.refTimers = []; restoreLine(); });
  }
  const playReference = () => playPair(string(), state.fret, 0, target().cents, ['もとの音', '目標の音']);
  // 自動のお手本。一時的な案内（「耳だけ: …」など）が出ている間は、読み終わるまで待つ
  function autoReference() {
    const wait = state.tempUntil - performance.now();
    if (wait > 0) { state.autoRefTimer = setTimeout(autoReference, wait); return; }
    playReference();
  }
  el.refBtn.addEventListener('click', playReference);

  // 課題や表示が変わった。押さえている最中なら、その試行は打ち切る（前の課題の判定を新しい課題に付けない）。
  // 前の結果は、音の課題（弦・フレット・目標）が同じ間は残す（表示モードの切替だけなら消さない）
  function taskChanged() {
    endAttempt(false);
    cancelRef();
    if (audio) audio.mute(now());
    judge.setTarget(target().cents);
    saveSettings();
    const s = state.shownTask;
    if (!s || s.string !== state.string || s.fret !== state.fret || s.target !== target().cents) clearResult();
    renderControls(); renderTask(); layoutBoard();
    if (!audio) return;
    try { audio.noteFor(string(), state.fret); } catch (e) { /* 鳴らす時に案内を出す */ }
    if (state.mode === 'ear') state.autoRefTimer = setTimeout(autoReference, CONFIG.autoRefDelayMs);
  }

  // ---------- コントロール ----------
  function buildSegment(node, list, get, set) {
    for (const item of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.key = item.key;
      const check = document.createElement('span');
      check.className = 'check'; check.setAttribute('aria-hidden', 'true'); check.textContent = '✓';
      b.appendChild(check);
      b.appendChild(document.createTextNode(item.label));
      b.addEventListener('click', () => { if (get() !== item.key) { set(item.key); taskChanged(); } });
      node.appendChild(b);
    }
  }
  function renderControls() {
    for (const [node, value] of [[el.targetSeg, state.target], [el.modeSeg, state.mode]]) {
      for (const b of node.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === value));
    }
    el.stringSel.value = state.string;
    el.fretSel.value = String(state.fret);
  }
  const addOption = (select, label, value) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    select.appendChild(o);
  };
  buildSegment(el.targetSeg, CONFIG.targets, () => state.target, (k) => { state.target = k; });
  buildSegment(el.modeSeg, CONFIG.modes, () => state.mode, (k) => { state.mode = k; });
  el.modeSeg.addEventListener('click', () => flash(state.mode === 'ear' ? TEXT.earMode : TEXT.meterMode));
  for (const s of CONFIG.strings) addOption(el.stringSel, s.label, s.key);
  for (const f of CONFIG.frets) addOption(el.fretSel, `${f}F`, String(f));
  el.stringSel.addEventListener('change', () => { state.string = findByKey(CONFIG.strings, el.stringSel.value, CONFIG.stringDefault).key; taskChanged(); });
  el.fretSel.addEventListener('change', () => { const f = Number(el.fretSel.value); state.fret = CONFIG.frets.includes(f) ? f : CONFIG.fretDefault; taskChanged(); });

  // ---------- 開始画面・使い方 ----------
  // 説明文の中の数字は CONFIG から入れる（値を変えても文がずれない）
  const fills = {
    tolerance: CONFIG.toleranceCents, holdS: CONFIG.holdMs / 1000, overS: CONFIG.overHoldMs / 1000, heldS: CONFIG.heldWindowMs / 1000,
    downStrings: CONFIG.strings.filter((s) => s.bendDown).map((s) => s.number).join('・'),
  };
  for (const n of document.querySelectorAll('[data-fill]')) n.textContent = String(fills[n.dataset.fill]);
  el.board.setAttribute('aria-label', TEXT.boardLabel(fills.downStrings));

  // 開始画面か使い方が出ている間は、うしろの操作部をフォーカスと読み上げの対象から外す
  const syncInert = () => { if ('inert' in el.app) el.app.inert = !el.overlay.hidden || !el.help.hidden; };
  const setHelp = (open) => {
    el.help.hidden = !open;
    syncInert();
    if (open) { el.help.scrollTop = 0; el.helpTitle.focus(); }
    else (el.overlay.hidden ? el.helpBtn : el.startBtn).focus();
  };
  el.helpBtn.addEventListener('click', () => { endAttempt(false); cancelRef(); if (audio) audio.mute(now()); restoreLine(); setHelp(true); });
  for (const b of [el.helpClose, el.helpCloseTop]) b.addEventListener('click', () => setHelp(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.help.hidden) setHelp(false); });

  // ---------- 描画ループ ----------
  function renderDebug() {
    if (!DEBUG) return;
    el.debug.textContent = [
      `ctx:${audio ? audio.ctx.state : 'none'} sr:${audio ? audio.ctx.sampleRate : '-'} voices:${audio ? audio.voiceCount() : 0}`
        + ` latency:${audio && audio.ctx.baseLatency !== undefined ? (audio.ctx.baseLatency * 1000).toFixed(0) : '-'}ms`,
      `ptr:${state.activeId === null ? '-' : state.activeId} ${string().label} fret:${state.fret} f0:${baseHz(string(), state.fret).toFixed(2)}`,
      `dPx:${state.dPx.toFixed(1)} dMm:${(state.dPx / geo.pxPerMm).toFixed(2)} cents:${state.cents.toFixed(1)} cap:${CONFIG.maxBendCents}`,
      `judge:${judge.state} band:${Math.round(judge.bandMs || 0)} over:${Math.round(judge.overMs || 0)} peak:${(judge.peak || 0).toFixed(1)} live:${judge.live || '-'}`,
      `pxPerMm:${geo.pxPerMm.toFixed(2)}/${CONFIG.pxPerMm} gapPx:${geo.gapPx.toFixed(1)} capPx:${geo.capPx.toFixed(0)}`
        + ` ¢/px@target:${centsPerPx(judge.target, string(), state.fret, geo.pxPerMm).toFixed(2)} board:${Math.round(geo.w)}x${Math.round(geo.h)}`,
    ].join('\n');
  }

  function frame(ts) {
    const dt = ts - lastTs;
    lastTs = ts;
    if (state.activeId !== null && audio) {
      readBend();
      audio.setBend(state.cents, now());
      const fired = judge.process({ cents: state.cents, dt: Math.max(0, dt) });
      if (fired && state.attemptMode === 'meter') showResult(judge.summary(), 'meter', false);
      // 音が鳴り終わったら試行も終える（無音のまま判定が進まないように）
      if (judge.t >= CONFIG.voiceMaxS * 1000) endAttempt(true);
    }
    if (state.tempUntil && ts > state.tempUntil) restoreLine();
    renderLive(ts); renderBoard(); renderDebug();
    requestAnimationFrame(frame);
  }

  // ---------- 開始 ----------
  el.startBtn.addEventListener('click', async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      el.startMsg.textContent = TEXT.unsupported;
      return;
    }
    if (!audio) {
      // iPhone の消音スイッチで音が消えないように（対応している環境だけ）
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 未対応 */ }
      const ctx = new AC({ latencyHint: 'interactive' });
      if (!audioSupported(ctx)) {
        el.startMsg.textContent = TEXT.unsupported;
        if (ctx.close) ctx.close().catch(() => {});
        return;
      }
      try {
        audio = createAudio(ctx);
        audio.noteFor(string(), state.fret);
      } catch (e) {
        audio = null;
        el.startMsg.textContent = TEXT.unsupported;
        return;
      }
    }
    audio.resume();
    el.overlay.hidden = true;
    syncInert();
    if (SELFTEST) {
      el.selftest.hidden = false;
      el.selftest.textContent = '自己診断を実行中…\n';
      try {
        await runSelfTest((line) => { el.selftest.textContent += line + '\n'; });
      } catch (err) {
        el.selftest.textContent += `\n不合格  実行できませんでした: ${err && err.message}`;
      }
    } else if (state.mode === 'ear') {
      state.autoRefTimer = setTimeout(autoReference, CONFIG.autoRefDelayMs);
    }
  });

  if (DEBUG) el.debug.hidden = false;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { endAttempt(false); layoutBoard(); }).observe(el.board);
  } else {
    window.addEventListener('resize', () => { endAttempt(false); layoutBoard(); });
  }
  syncInert();
  renderControls();
  renderTask();
  layoutBoard();
  renderHistory();
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
  else initApp();
}
