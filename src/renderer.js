(() => {
  const Cathode = (globalThis.Cathode = globalThis.Cathode || {});

  const UNIFORMS = [
    'u_texture',
    'u_resolution',
    'u_time',
    'u_curvature',
    'u_scanlines',
    'u_grille',
    'u_glow',
    'u_aberration',
    'u_vignette',
    'u_noise',
    'u_flicker',
    'u_brightness',
    'u_contrast',
    'u_saturation',
    'u_video_aspect',
    'u_output_aspect',
    'u_phosphor',
    'u_tint'
  ];

  class Renderer {
    constructor(video, player, settings) {
      this.video = video;
      this.player = player;
      this.settings = settings;

      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.buffer = null;
      this.texture = null;
      this.uniforms = {};

      this.running = false;
      this.failed = false;
      this.lost = false;
      this.onError = null;

      this._frameId = null;
      this._frameKind = null;
      this._resizeObserver = null;
      this._texWidth = 0;
      this._texHeight = 0;
      this._positionPatched = false;
      this._previousPosition = '';

      this._onPlay = () => {
        if (!this.running) return;
        this._recover();
        this._draw();
        this._requestFrame();
      };
      this._onPause = () => this._draw();
      this._onSeek = () => this._draw();
      this._onEmptied = () => this._clear();
      this._onWindowResize = () => this._resize();
      this._onVisibility = () => {
        if (!document.hidden) this._draw();
      };
      this._onContextLost = (event) => {
        event.preventDefault();
        this.lost = true;
        this._stopLoop();
      };
      this._onContextRestored = () => {
        this.lost = false;
        try {
          this._setupGL();
          this._draw();
          this._requestFrame();
        } catch (error) {
          this._fail(error);
        }
      };

      this._mediaEvents = [
        ['play', this._onPlay],
        ['playing', this._onPlay],
        ['pause', this._onPause],
        ['seeked', this._onSeek],
        ['canplay', this._onSeek],
        ['loadeddata', this._onSeek],
        ['resize', this._onSeek],
        ['emptied', this._onEmptied]
      ];
    }

    init() {
      if (this.canvas) return;

      const canvas = document.createElement('canvas');
      canvas.className = 'cathode-canvas';
      canvas.setAttribute('aria-hidden', 'true');

      const options = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'default'
      };

      const gl =
        canvas.getContext('webgl', options) ||
        canvas.getContext('experimental-webgl', options);

      if (!gl) throw new Error('WebGL is not available');

      this.canvas = canvas;
      this.gl = gl;

      canvas.addEventListener('webglcontextlost', this._onContextLost, false);
      canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

      this._setupGL();

      const position = getComputedStyle(this.player).position;
      if (position === 'static') {
        this._previousPosition = this.player.style.position;
        this.player.style.position = 'relative';
        this._positionPatched = true;
      }

      this.player.appendChild(canvas);

      this._resizeObserver = new ResizeObserver(() => this._resize());
      this._resizeObserver.observe(this.player);
      window.addEventListener('resize', this._onWindowResize);
      document.addEventListener('visibilitychange', this._onVisibility);

      for (const [event, handler] of this._mediaEvents) {
        this.video.addEventListener(event, handler);
      }

      this._resize();
      this.start();
      this._draw();
    }

    setSettings(settings) {
      this.settings = settings;
      this._draw();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._requestFrame();
    }

    stop() {
      this.running = false;
      this._stopLoop();
    }

    destroy() {
      this.stop();

      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      window.removeEventListener('resize', this._onWindowResize);
      document.removeEventListener('visibilitychange', this._onVisibility);

      if (this.video) {
        for (const [event, handler] of this._mediaEvents) {
          this.video.removeEventListener(event, handler);
        }
      }

      if (this.canvas) {
        this.canvas.removeEventListener('webglcontextlost', this._onContextLost, false);
        this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored, false);

        const gl = this.gl;
        if (gl) {
          try {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
          } catch (error) {
            /* context teardown is best-effort */
          }
        }
        this.canvas.remove();
      }

      if (this._positionPatched && this.player) {
        this.player.style.position = this._previousPosition;
      }

      this.canvas = null;
      this.gl = null;
      this.program = null;
      this.buffer = null;
      this.texture = null;
      this.uniforms = {};
      this.video = null;
      this.player = null;
    }

    _setupGL() {
      const gl = this.gl;

      const vertex = this._compile(gl.VERTEX_SHADER, Cathode.SHADERS.vertex);
      const fragment = this._compile(gl.FRAGMENT_SHADER, Cathode.SHADERS.fragment);

      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        throw new Error('Shader link failed: ' + log);
      }

      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.useProgram(program);
      this.program = program;

      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW
      );

      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      this.uniforms = {};
      for (const name of UNIFORMS) {
        this.uniforms[name] = gl.getUniformLocation(program, name);
      }

      gl.uniform1i(this.uniforms.u_texture, 0);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255])
      );
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.texture = texture;
      this._texWidth = 0;
      this._texHeight = 0;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 1);
    }

    _compile(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compile failed: ' + log);
      }

      return shader;
    }

    _resize() {
      if (!this.canvas || !this.player) return;

      const rect = this.player.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this._draw();
      }
    }

    _requestFrame() {
      if (!this.running || this.lost || this.failed || this._frameId !== null) return;

      const video = this.video;
      if (!video) return;

      if (typeof video.requestVideoFrameCallback === 'function') {
        this._frameKind = 'video';
        try {
          this._frameId = video.requestVideoFrameCallback(() => {
            this._frameId = null;
            if (!this.running || this.lost) return;
            this._draw();
            // rVFC only fires on a presented frame, so staying armed while paused
            // catches the frame that lands after the 'pause'/'seeked' event.
            this._requestFrame();
          });
          return;
        } catch (error) {
          this._frameId = null;
        }
      }

      this._frameKind = 'raf';
      this._frameId = requestAnimationFrame(() => {
        this._frameId = null;
        if (!this.running || this.lost) return;
        this._draw();
        if (!this.video.paused && !this.video.ended) this._requestFrame();
      });
    }

    _stopLoop() {
      if (this._frameId !== null) {
        if (
          this._frameKind === 'video' &&
          this.video &&
          typeof this.video.cancelVideoFrameCallback === 'function'
        ) {
          try {
            this.video.cancelVideoFrameCallback(this._frameId);
          } catch (error) {
            /* frame already delivered */
          }
        } else {
          cancelAnimationFrame(this._frameId);
        }
      }
      this._frameId = null;
      this._frameKind = null;
    }

    _draw() {
      const gl = this.gl;
      const video = this.video;
      if (!gl || !this.canvas || this.lost || this.failed || !video) return;
      if (document.hidden) return;

      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        this._clear();
        return;
      }

      const width = this.canvas.width;
      const height = this.canvas.height;

      gl.viewport(0, 0, width, height);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);

      try {
        if (this._texWidth !== video.videoWidth || this._texHeight !== video.videoHeight) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          this._texWidth = video.videoWidth;
          this._texHeight = video.videoHeight;
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }
      } catch (error) {
        this._fail(error);
        return;
      }

      const s = this.settings;
      const phosphor = Cathode.PHOSPHORS[s.phosphor] || Cathode.PHOSPHORS.color;
      const u = this.uniforms;

      gl.uniform2f(u.u_resolution, width, height);
      gl.uniform1f(u.u_time, performance.now() / 1000);
      gl.uniform1f(u.u_curvature, s.curvature);
      gl.uniform1f(u.u_scanlines, s.scanlines);
      gl.uniform1f(u.u_grille, s.grille);
      gl.uniform1f(u.u_glow, s.glow);
      gl.uniform1f(u.u_aberration, s.aberration);
      gl.uniform1f(u.u_vignette, s.vignette);
      gl.uniform1f(u.u_noise, s.noise);
      gl.uniform1f(u.u_flicker, s.flicker);
      gl.uniform1f(u.u_brightness, s.brightness);
      gl.uniform1f(u.u_contrast, s.contrast);
      gl.uniform1f(u.u_saturation, s.saturation);
      gl.uniform1f(u.u_video_aspect, video.videoWidth / video.videoHeight);
      gl.uniform1f(u.u_output_aspect, width / height);
      gl.uniform1f(u.u_phosphor, phosphor.mono);
      gl.uniform3f(u.u_tint, phosphor.tint[0], phosphor.tint[1], phosphor.tint[2]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    _clear() {
      const gl = this.gl;
      if (!gl || !this.canvas || this.lost) return;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    _recover() {
      if (!this.failed) return;
      this.failed = false;
      if (this.canvas) this.canvas.style.display = 'block';
    }

    _fail(error) {
      if (this.failed) return;
      this.failed = true;

      if (this.canvas) this.canvas.style.display = 'none';
      this._stopLoop();

      if (this.onError) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  Cathode.Renderer = Renderer;
})();
