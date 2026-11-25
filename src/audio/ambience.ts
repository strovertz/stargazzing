/**
 * Som ambiente gerado na hora com Web Audio: nenhum arquivo de áudio, nenhuma licença.
 * Camadas: vento na mata, chuva, trovão, pássaros de dia, grilos à noite, estalos da fogueira
 * e uma "taverna" (alaúde dedilhado em escala pentatônica) quando a câmera está perto de uma roda.
 */
export interface AmbienceState {
  rain: number; wind: number; storm: boolean;
  /** 0 noite, 1 dia */
  day: number;
  /** 0 a 1: quão perto a câmera está de uma fogueira */
  fire: number;
  /** pessoas na roda da fogueira mais próxima */
  crowd: number;
  /** brilho do relâmpago agora (0 a 1) */
  flash: number;
  /** instrumento de quem toca na roda (índice em INSTRUMENTS) e se há dois músicos (dueto) */
  voice?: number;
  duet?: boolean;
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];

export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode; private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode; private rumbleGain!: GainNode;
  private st: AmbienceState = { rain: 0, wind: 0.3, storm: false, day: 1, fire: 0, crowd: 0, flash: 0 };
  private nextBird = 0; private nextCricket = 0; private nextCrackle = 0; private nextNote = 0; private lastFlash = 0;
  private note = 2; private timer = 0;
  /** rádio da taverna: a melodia da noite (sorteada pela data) e a posição nela */
  tune: number[] = []; private ti = 0;
  /** troca a melodia (cada fogueira tem a sua) e volta ao começo dela */
  setTune(t: number[]): void { if (t.join() !== this.tune.join()) { this.tune = t; this.ti = 0; } }
  on = false;

  /** Precisa vir de um clique (política de autoplay dos navegadores). */
  async enable(): Promise<void> {
    if (!this.ctx) this.build();
    await this.ctx!.resume();
    this.master.gain.setTargetAtTime(0.55, this.ctx!.currentTime, 0.6);
    this.on = true;
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 120);
  }

  disable(): void {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    window.setTimeout(() => { if (!this.on) void this.ctx?.suspend(); }, 900);
  }

  private voice = 0; private duet = false;
  update(s: AmbienceState): void {
    this.voice = s.voice ?? 0; this.duet = !!s.duet;
    this.st = s;
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.025 + s.wind * 0.09 + (s.storm ? 0.05 : 0), t, 1.5);
    this.windFilter.frequency.setTargetAtTime(280 + s.wind * 700, t, 2);
    this.rainGain.gain.setTargetAtTime(s.rain > 0.08 ? 0.04 + s.rain * 0.2 : 0, t, 1.5);
    this.rumbleGain.gain.setTargetAtTime(s.storm ? 0.12 : s.rain * 0.03, t, 2);
  }

  private build(): void {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    // ruído branco de 3 s em loop, base de vento, chuva e estalos
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random() * 2; s.start(); return s; };
    // vento: ruído grave com filtro que oscila devagar
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 400; this.windFilter.Q.value = 0.8;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(this.windFilter.frequency); lfo.start();
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);
    // chuva: ruído em faixa média-alta
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    loop().connect(hp).connect(lp).connect(this.rainGain).connect(this.master);
    // ronco da tempestade
    const rb = ctx.createBiquadFilter(); rb.type = 'lowpass'; rb.frequency.value = 120;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    loop().connect(rb).connect(this.rumbleGain).connect(this.master);
  }

  /** Eventos curtos agendados alguns décimos à frente. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const t = ctx.currentTime, s = this.st, ahead = t + 0.25;
    if (s.day > 0.5 && s.rain < 0.2) {
      if (this.nextBird < t) this.nextBird = t + 1 + Math.random() * 5;
      if (this.nextBird < ahead) { this.bird(this.nextBird); this.nextBird += 2.5 + Math.random() * (7 - s.wind * 3); }
    } else if (s.day < 0.3 && s.rain < 0.3) {
      if (this.nextCricket < t) this.nextCricket = t + Math.random();
      if (this.nextCricket < ahead) { this.cricket(this.nextCricket); this.nextCricket += 2.5 + Math.random() * 5; }
    }
    if (s.fire > 0.05 && s.rain < 0.6) {
      if (this.nextCrackle < t) this.nextCrackle = t;
      while (this.nextCrackle < ahead) { this.crackle(this.nextCrackle, s.fire); this.nextCrackle += 0.04 + Math.random() * (0.5 / (0.3 + s.fire)); }
    }
    if (s.fire > 0.15 && s.crowd >= 2 && !s.storm) {
      if (this.nextNote < t) this.nextNote = t + 0.05;
      while (this.nextNote < ahead) { this.pluck(this.nextNote, s.fire); this.nextNote += this.tune.length ? [0.32, 0.32, 0.64, 0.32, 0.16, 0.48][(this.ti * 7 + this.note) % 6]! : [0.32, 0.32, 0.64, 0.16][Math.floor(Math.random() * 4)]!; }
    }
    if (s.storm && s.flash > 0.5 && t - this.lastFlash > 1.5) { this.lastFlash = t; this.thunder(t + 0.4 + Math.random() * 1.6); }
  }

  private env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master);
    return g;
  }

  private bird(at: number): void {
    const ctx = this.ctx!, n = 2 + Math.floor(Math.random() * 4), base = 2200 + Math.random() * 1800;
    for (let k = 0; k < n; k++) {
      const t0 = at + k * (0.09 + Math.random() * 0.06), o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t0 + 0.06);
      o.connect(this.env(t0, 0.035, 0.01, 0.08));
      o.start(t0); o.stop(t0 + 0.12);
    }
  }

  /** Grilo ao longe: trinado curto e grave, filtrado e baixinho, em grupos irregulares. */
  private cricket(at: number): void {
    const ctx = this.ctx!, f = ctx.createBiquadFilter(), base = 2600 + Math.random() * 500, pulses = 3 + Math.floor(Math.random() * 4);
    f.type = 'bandpass'; f.frequency.value = base; f.Q.value = 6;
    const out = this.env(at, 0.006, 0.02, 0.05 * pulses + 0.15);
    f.connect(out);
    for (let k = 0; k < pulses; k++) {
      const t0 = at + k * (0.045 + Math.random() * 0.01), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = base;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.008); g.gain.linearRampToValueAtTime(0, t0 + 0.03);
      o.connect(g).connect(f);
      o.start(t0); o.stop(t0 + 0.035);
    }
  }

  private crackle(at: number, near: number): void {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = this.noise;
    f.type = 'bandpass'; f.frequency.value = 1500 + Math.random() * 3000; f.Q.value = 1.5;
    src.connect(f).connect(this.env(at, 0.05 + near * 0.12 * Math.random(), 0.002, 0.03 + Math.random() * 0.05));
    src.start(at, Math.random() * 2, 0.1);
  }

  /** Alaúde de taverna: corda dedilhada (triângulo + filtro que fecha) andando pela pentatônica. */
  private pluck(at: number, near: number): void {
    const ctx = this.ctx!;
    this.note = this.tune.length ? Math.min(PENTA.length - 1, this.tune[this.ti++ % this.tune.length]!) : Math.max(0, Math.min(PENTA.length - 1, this.note + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]!));
    const freq = 220 * 2 ** (PENTA[this.note]! / 12), v = this.voice;
    if (v === 2) {
      // tambor: batida grave com pele (seno que despenca) e chiado curto
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(this.note % 2 ? 140 : 95, at); o.frequency.exponentialRampToValueAtTime(50, at + 0.18);
      o.connect(this.env(at, 0.09 * near, 0.003, 0.25)); o.start(at); o.stop(at + 0.3);
    } else {
      // alaúde (triângulo que fecha), flauta (seno com vibrato e ataque lento), harpa (seno longo e brilhante), gaita (quadrada abafada)
      const type: OscillatorType = v === 1 || v === 3 ? 'sine' : v === 4 ? 'square' : 'triangle';
      const mul = v === 1 ? 2 : 1, attack = v === 1 ? 0.06 : v === 4 ? 0.03 : 0.005, decay = v === 3 ? 1.4 : v === 1 ? 0.45 : 0.7;
      const parts: readonly (readonly [number, number])[] = v === 3 ? [[1, 1], [2, 0.4], [3, 0.15]] : v === 1 ? [[1, 1]] : [[1, 1], [2, 0.3]];
      for (const [m, vol] of parts) {
        const o = ctx.createOscillator(), f = ctx.createBiquadFilter();
        o.type = type; o.frequency.value = freq * mul * m;
        if (v === 1) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.value = freq * 0.012; lfo.connect(lg).connect(o.frequency); lfo.start(at); lfo.stop(at + decay + 0.1); }
        f.type = 'lowpass';
        f.frequency.setValueAtTime(v === 4 ? 1400 : 3200, at); f.frequency.exponentialRampToValueAtTime(v === 3 ? 1200 : 400, at + decay * 0.7);
        o.connect(f).connect(this.env(at, (v === 4 ? 0.025 : 0.05) * near * vol, attack, decay));
        o.start(at); o.stop(at + attack + decay + 0.1);
      }
    }
    // dueto: um segundo músico faz o baixo (tônica e quinta) a cada tempo; sem dueto, bordão de vez em quando
    if (this.duet ? this.ti % 2 === 0 : Math.random() < 0.25) {
      const o = ctx.createOscillator(); o.type = this.duet ? 'triangle' : 'sine'; o.frequency.value = this.duet ? (this.ti % 4 === 0 ? 110 : 164.8) : 110;
      o.connect(this.env(at, (this.duet ? 0.05 : 0.04) * near, 0.02, 1.2)); o.start(at); o.stop(at + 1.3);
    }
  }


  private thunder(at: number): void {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    src.buffer = this.noise;
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, at); f.frequency.exponentialRampToValueAtTime(60, at + 2.5);
    src.connect(f).connect(this.env(at, 0.5, 0.05, 2.6));
    src.start(at, 0, 2.8);
  }
}
