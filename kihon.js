/* ============================================================
   kihon.js — 明るい顔と暗い顔（2026-10-27〜。kihon.css と対）

   ・最初は、暗い顔（宵）で出す（2026-11-20〜。それまでは閲覧機の設定に合わせていた）。
   ・上の行の「明るくする／暗くする」を押した人には、その顔を覚えておく。
     覚える場所は、その人の閲覧機の中だけ（localStorage）。どこへも送らない。
   ・選んだ顔は <html data-iro="akarui|kurai"> の札で伝える。色そのものは kihon.css が持つ
     （色をここに書くと、DESIGN.md と kihon.css と、ここの三か所になる＝食い違いの種）。

   【なぜ <head> で読み込むか】
     札を立てる前に一度でも画面が描かれると、暗い顔を選んだ人の画面が、
     開いた瞬間だけ白く光る。だから本文より先に、札だけは立ててしまう。
     ボタンを結ぶのは、本文ができてから（DOMContentLoaded）。
   ============================================================ */
(function () {
  var KAGI = 'engawaya-iro';
  var root = document.documentElement;

  /* 覚えている顔があれば、先に札を立てる。読めない閲覧機（覚え書きを止めている等）でも、
     設定に合わせた顔で出るだけ＝何も壊れない。 */
  try {
    var oboe = localStorage.getItem(KAGI);
    if (oboe === 'akarui' || oboe === 'kurai') root.setAttribute('data-iro', oboe);
  } catch (e) { /* 覚えられない閲覧機。設定に合わせる */ }

  /* 2026-11-20〜 選んでいない人には、まず暗い顔（宵）を見せる。
     Xの印と背景が宵の色なので、そこから来た人が「同じ家だ」と分かるように。
     「明るくする」を押した人には、いままでどおりその顔を覚えておく。 */
  if (!root.getAttribute('data-iro')) root.setAttribute('data-iro', 'kurai');

  function settei() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function kurai() {
    var fuda = root.getAttribute('data-iro');
    return fuda ? fuda === 'kurai' : settei();
  }

  function musubu() {
    var b = document.getElementById('iroBtn');
    if (!b) return;
    /* ボタンの字は「押すと、どうなるか」を言う */
    function hyouji() { b.textContent = kurai() ? '明るくする' : '暗くする'; }
    b.addEventListener('click', function () {
      var tsugi = kurai() ? 'akarui' : 'kurai';
      root.setAttribute('data-iro', tsugi);
      try { localStorage.setItem(KAGI, tsugi); } catch (e) { /* 覚えられなくても、いまは切り替わる */ }
      hyouji();
    });
    /* 札を立てていない人は、設定を変えたらそのまま追いかける */
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', hyouji);
      else if (mq.addListener) mq.addListener(hyouji);
    }
    hyouji();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', musubu);
  else musubu();
})();

/* ------------------------------------------------------------
   連絡先を、開いた瞬間に組み立てる。

   なぜ HTML に生で書かないか：公開ページに書かれたメールアドレスは、
   迷惑メール業者の巡回ロボットが拾って歩く。文字を分けて持っておき、
   ここで @ に組み直せば、人には押せて機械には読みにくい。
   完全には防げないので、増えてきたら受け側（Gmail）で振り分ける。

   件名を入れておくのは、届いたときに何の話か一目で分かるように。
   ------------------------------------------------------------ */
/* 窓口は info@engawaya.com（K'Ad蔵人の免責事項に書いてある住所と同じ）。
   窓口を二つ作ると、片方が忘れられて「返事が来ない店」になる。一つに揃える。 */
/* 2026-10-27 表紙から kihon.js へ移した（どのページの足元にも連絡先があるため）。
   kihon.js は <head> で読むので、本文ができてから組み立てる。 */
(function () {
  function kumitate() {
    var na = 'info', ie = 'engawaya.com';
    var list = document.querySelectorAll('.renraku');
    for (var k = 0; k < list.length; k++) {
      var a = document.createElement('a');
      a.href = 'mailto:' + na + '@' + ie
             + '?subject=' + encodeURIComponent('縁側屋の道具のこと');
      a.textContent = na + '@' + ie;
      list[k].textContent = '';
      list[k].appendChild(a);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kumitate);
  else kumitate();
})();

/* ------------------------------------------------------------
   麻の葉の線を、光が走る（2026-11-20）。

   博喜さんのご注文：「背景の麻の六角形を、ランダムに、導火線や、電飾のように、
   うっすら線を沿って光が動いていく様子」。

   【仕組み】
     地の柄（icon/asanoha-*.svg）は、一辺 132 の正三角形の網と、三角の真ん中（重心）から
     三つの角へ引いた線でできている。その線の上だけを、小さな光が歩く。
       ・角に着いたら、十二の方角（三角の辺へ六つ・重心へ六つ）から、来た道以外を一つ選ぶ。
       ・重心に着いたら、左右どちらかへ六十度曲がって、次の角へ。
     絵は一枚の透けた紙（canvas）に描き、地の柄のすぐ上・本文の下に敷く。
     ⚠️網の寸法 132 は、柄の SVG と同じ数字。柄を描き直す日は、ここも一緒に直す
       （ずれると、光が線の無い所を走る）。

   【うっすら、にしてある理由】
     ここは字を読む家。光が字より目立ったら、裏地が表に出たことになる（DESIGN.md 1-0「裏地」）。
     線の濃さは暗い顔で 3 割・明るい顔で 2 割まで、数は画面の広さに合わせて 3〜8 本。
     （はじめは 5 割・3 割で作り、博喜さんの「もう少し薄く」で下げた。数と速さはそのまま。）

   【頭の瞬き】
     博喜さんのご注文「頭の丸をランダムに瞬かせる」。頭の点は、0.06〜0.3 秒ごとに
     次の明るさをでたらめに決めて、そこへなめらかに寄っていく（電球がちらつくように）。
     たまに（八回に一回ほど）強く光る。光ごとに間合いが違うので、揃って瞬くことはない。
     ⚠️瞬くのは頭だけ。尾まで瞬かせると、線ぜんたいが点滅して、字を読む邪魔になる。

   【走らせない場合】
     ・「動きを減らす」を選んでいる閲覧機（乗り物酔いのように、動く物で具合が悪くなる方がいる）。
     ・タブが裏に回っているあいだ（電池を使わない）。
   ------------------------------------------------------------ */
(function () {
  if (!window.requestAnimationFrame) return;
  var herasu = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (herasu && herasu.matches) return;

  var A = 132;                       /* 三角の一辺（柄の SVG と同じ） */
  var H = A * Math.sqrt(3) / 2;      /* 段の高さ */
  var R = A / Math.sqrt(3);          /* 角から重心まで */
  var HAYASA = 95;                   /* 一秒に進む長さ（px） */
  var O_NAGASA = 190;                /* 尾の長さ（px） */
  var IRO_YORU = ['255,197,107', '69,211,235', '222,95,180', '255,122,99'];   /* 琥珀・水色・紅・朱 */
  var IRO_HIRU = ['168,50,95', '60,50,140'];                                  /* 深い紅・藍 */

  var cv, cx, haba, take, dpr, hikari = [], mae = 0, ugoku = false;

  function start() {
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');      /* 飾り。読み上げには出さない */
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
    document.body.insertBefore(cv, document.body.firstChild);
    cx = cv.getContext('2d');
    hakaru();
    window.addEventListener('resize', hakaru);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) ugoku = false; else hajimeru();
    });
    hajimeru();
  }

  /* 紙の大きさを画面に合わせる。細かい画面（Retina など）では、その分だけ点を増やす。 */
  function hakaru() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    haba = window.innerWidth; take = window.innerHeight;
    cv.width = Math.round(haba * dpr); cv.height = Math.round(take * dpr);
    var kazu = Math.max(3, Math.min(8, Math.round(haba * take / 160000)));
    while (hikari.length < kazu) hikari.push(umareru(true));
    hikari.length = kazu;
  }

  /* 光がひとつ生まれる。いま見えている画面のどこかの「角」から。 */
  function umareru(saisho) {
    var x = window.pageXOffset + Math.random() * haba;
    var y = window.pageYOffset + Math.random() * take;
    var j = Math.round(y / H);
    var zure = (((j % 2) + 2) % 2) * A / 2;       /* 一段おきに、半分ずれている */
    var i = Math.round((x - zure) / A);
    var p = { x: i * A + zure, y: j * H };
    var h = {
      ato: [p],            /* 通ってきた曲がり角（新しいものが後ろ） */
      kara: p, made: null, susunda: 0, nagasa: 0,
      kado: true,          /* いま向かっている先が「角」か（false なら重心） */
      muki: -1,            /* いまの向き（30 度きざみの番号 0〜11） */
      toshi: 0,
      inochi: 5 + Math.random() * 6,                 /* 何秒走るか */
      matsu: saisho ? Math.random() * 4 : 0.5 + Math.random() * 3,   /* 生まれるまでの間 */
      iro: Math.floor(Math.random() * 4),
      mata: 1, mataSaki: 1, mataMatsu: 0     /* 瞬き：いまの明るさ・次の明るさ・次を決めるまでの間 */
    };
    tsugi(h, true);
    return h;
  }

  /* 次の行き先を決める。imaKado＝いま立っているのが角かどうか。 */
  function tsugi(h, imaKado) {
    var k;
    if (imaKado) {
      do { k = Math.floor(Math.random() * 12); } while (h.muki >= 0 && k === (h.muki + 6) % 12);
      h.kado = (k % 2 === 0);                        /* 偶数の向き＝となりの角／奇数＝重心 */
    } else {
      k = (h.muki + (Math.random() < 0.5 ? 2 : 10)) % 12;   /* 重心では左右どちらかへ 60 度 */
      h.kado = true;
    }
    h.muki = k;
    var kaku = k * Math.PI / 6;
    h.nagasa = h.kado && imaKado ? A : R;
    h.made = { x: h.kara.x + Math.cos(kaku) * h.nagasa, y: h.kara.y + Math.sin(kaku) * h.nagasa };
    h.susunda = 0;
  }

  function hajimeru() {
    if (ugoku) return;
    ugoku = true; mae = 0;
    requestAnimationFrame(egaku);
  }

  function egaku(ima) {
    if (!ugoku) return;
    var dt = mae ? Math.min((ima - mae) / 1000, 0.05) : 0;   /* 止まっていた後に飛ばないよう、上限を置く */
    mae = ima;
    var sx = window.pageXOffset, sy = window.pageYOffset;
    var hiru = document.documentElement.getAttribute('data-iro') === 'akarui';
    var iro = hiru ? IRO_HIRU : IRO_YORU;
    var koi = hiru ? 0.2 : 0.32;

    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, haba, take);
    cx.lineCap = 'round'; cx.lineWidth = 1.4;

    for (var n = 0; n < hikari.length; n++) {
      var h = hikari[n];
      if (h.matsu > 0) { h.matsu -= dt; continue; }
      h.toshi += dt;

      /* 進む。角や重心に着いたら、曲がり角として覚えて、次の行き先を決める。 */
      h.susunda += HAYASA * dt;
      while (h.susunda >= h.nagasa) {
        var amari = h.susunda - h.nagasa;
        var tsuita = h.kado;
        h.kara = h.made; h.ato.push(h.kara);
        if (h.ato.length > 8) h.ato.shift();
        tsugi(h, tsuita);
        h.susunda = amari;
      }
      var t = h.susunda / h.nagasa;
      var ax = h.kara.x + (h.made.x - h.kara.x) * t, ay = h.kara.y + (h.made.y - h.kara.y) * t;

      /* 生まれて 0.8 秒でともり、終わりの 1.2 秒で消える。画面の外へ出たら、早めに終える。 */
      var nokori = h.inochi - h.toshi;
      var akarusa = Math.max(0, Math.min(1, h.toshi / 0.8, nokori / 1.2));
      var soto = ax - sx < -A || ax - sx > haba + A || ay - sy < -A || ay - sy > take + A;
      if (nokori <= 0 || (soto && h.toshi > 1)) { hikari[n] = umareru(false); continue; }

      /* 尾。頭から後ろへたどりながら、だんだん薄くする。 */
      var c = iro[h.iro % iro.length];
      var px = ax, py = ay, tootta = 0;
      for (var m = h.ato.length - 1; m >= 0 && tootta < O_NAGASA; m--) {
        var q = h.ato[m];
        var d = Math.sqrt((q.x - px) * (q.x - px) + (q.y - py) * (q.y - py));
        if (d < 0.01) continue;
        var qx = q.x, qy = q.y;
        if (tootta + d > O_NAGASA) {                 /* 尾の終わりは、線の途中で切る */
          var w = (O_NAGASA - tootta) / d;
          qx = px + (q.x - px) * w; qy = py + (q.y - py) * w; d = O_NAGASA - tootta;
        }
        var g = cx.createLinearGradient(px - sx, py - sy, qx - sx, qy - sy);
        g.addColorStop(0, 'rgba(' + c + ',' + (koi * akarusa * (1 - tootta / O_NAGASA)).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + c + ',' + (koi * akarusa * (1 - (tootta + d) / O_NAGASA)).toFixed(3) + ')');
        cx.strokeStyle = g;
        cx.beginPath(); cx.moveTo(px - sx, py - sy); cx.lineTo(qx - sx, qy - sy); cx.stroke();
        tootta += d; px = qx; py = qy;
      }

      /* 頭の瞬き。間が尽きたら次の明るさを決め、いまの明るさをそこへ寄せていく。 */
      h.mataMatsu -= dt;
      if (h.mataMatsu <= 0) {
        h.mataMatsu = 0.06 + Math.random() * 0.24;
        h.mataSaki = Math.random() < 0.13 ? 2.6 : 0.25 + Math.random() * 1.15;   /* たまに強く */
      }
      h.mata += (h.mataSaki - h.mata) * Math.min(1, dt * 18);

      /* 頭。小さな、にじんだ点。明るく瞬いたときは、にじみも少し広がる。 */
      var hankei = 3.5 + 2.2 * h.mata;
      var gr = cx.createRadialGradient(ax - sx, ay - sy, 0, ax - sx, ay - sy, hankei);
      gr.addColorStop(0, 'rgba(' + c + ',' + (Math.min(0.95, koi * 1.5 * h.mata) * akarusa).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(' + c + ',0)');
      cx.fillStyle = gr;
      cx.beginPath(); cx.arc(ax - sx, ay - sy, hankei, 0, Math.PI * 2); cx.fill();
    }
    requestAnimationFrame(egaku);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
