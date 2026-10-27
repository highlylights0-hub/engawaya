/* ============================================================
   kihon.js — 明るい顔と暗い顔（2026-10-27〜。kihon.css と対）

   ・最初は、閲覧機の設定（ダークモード）に合わせる。何もしなければ、それだけ。
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
