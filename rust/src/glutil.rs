//! Minimal OpenGL helpers (programs, textures, FBOs, one fullscreen quad).

use anyhow::{anyhow, bail, Context, Result};
use glow::HasContext;
use std::cell::RefCell;
use std::collections::HashMap;

pub struct Program {
    pub id: glow::Program,
    locations: RefCell<HashMap<String, Option<glow::UniformLocation>>>,
}

impl Program {
    pub fn new(gl: &glow::Context, vertex: &str, fragment: &str, label: &str) -> Result<Self> {
        unsafe {
            let vs = compile(gl, glow::VERTEX_SHADER, vertex, label)?;
            let fs = compile(gl, glow::FRAGMENT_SHADER, fragment, label)?;
            let id = gl
                .create_program()
                .map_err(|e| anyhow!("glCreateProgram: {e}"))?;
            gl.attach_shader(id, vs);
            gl.attach_shader(id, fs);
            gl.link_program(id);
            gl.delete_shader(vs);
            gl.delete_shader(fs);

            if !gl.get_program_link_status(id) {
                let log = gl.get_program_info_log(id);
                gl.delete_program(id);
                bail!("linking shader '{label}' failed:\n{log}");
            }
            Ok(Self {
                id,
                locations: RefCell::new(HashMap::new()),
            })
        }
    }

    pub fn bind(&self, gl: &glow::Context) {
        unsafe { gl.use_program(Some(self.id)) }
    }

    fn loc(&self, gl: &glow::Context, name: &str) -> Option<glow::UniformLocation> {
        if let Some(loc) = self.locations.borrow().get(name) {
            return loc.clone();
        }
        let loc = unsafe { gl.get_uniform_location(self.id, name) };
        self.locations
            .borrow_mut()
            .insert(name.to_string(), loc.clone());
        loc
    }

    pub fn f32(&self, gl: &glow::Context, name: &str, v: f32) {
        if let Some(loc) = self.loc(gl, name) {
            unsafe { gl.uniform_1_f32(Some(&loc), v) }
        }
    }

    pub fn vec2(&self, gl: &glow::Context, name: &str, x: f32, y: f32) {
        if let Some(loc) = self.loc(gl, name) {
            unsafe { gl.uniform_2_f32(Some(&loc), x, y) }
        }
    }

    pub fn vec3(&self, gl: &glow::Context, name: &str, x: f32, y: f32, z: f32) {
        if let Some(loc) = self.loc(gl, name) {
            unsafe { gl.uniform_3_f32(Some(&loc), x, y, z) }
        }
    }

    pub fn i32(&self, gl: &glow::Context, name: &str, v: i32) {
        if let Some(loc) = self.loc(gl, name) {
            unsafe { gl.uniform_1_i32(Some(&loc), v) }
        }
    }

    pub fn bool(&self, gl: &glow::Context, name: &str, v: bool) {
        self.i32(gl, name, i32::from(v))
    }

    pub fn mat2(&self, gl: &glow::Context, name: &str, m: &[f32; 4]) {
        if let Some(loc) = self.loc(gl, name) {
            unsafe { gl.uniform_matrix_2_f32_slice(Some(&loc), false, m) }
        }
    }

    /// Bind a sampler to a texture unit once; texture bindings are per-unit.
    pub fn sampler(&self, gl: &glow::Context, name: &str, unit: u32) {
        self.i32(gl, name, unit as i32);
    }

    pub fn resolution(&self, gl: &glow::Context, w: i32, h: i32) {
        self.vec2(gl, "iResolution", w as f32, h as f32);
    }
}

impl Drop for Program {
    fn drop(&mut self) {
        // The context is always destroyed after the programs in this app.
    }
}

unsafe fn compile(
    gl: &glow::Context,
    kind: u32,
    source: &str,
    label: &str,
) -> Result<glow::Shader> {
    unsafe {
        let shader = gl
            .create_shader(kind)
            .map_err(|e| anyhow!("glCreateShader: {e}"))?;
        gl.shader_source(shader, source);
        gl.compile_shader(shader);
        if !gl.get_shader_compile_status(shader) {
            let log = gl.get_shader_info_log(shader);
            gl.delete_shader(shader);
            let kind_name = if kind == glow::VERTEX_SHADER {
                "vertex"
            } else {
                "fragment"
            };
            bail!("compiling {kind_name} shader '{label}' failed:\n{log}");
        }
        Ok(shader)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    Linear,
    /// All current textures use linear filtering; kept for pixel-art sources.
    #[allow(dead_code)]
    Nearest,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Wrap {
    ClampEdge,
    ClampBorder,
    Repeat,
}

pub struct Texture {
    pub id: glow::Texture,
    pub w: i32,
    pub h: i32,
}

impl Texture {
    pub fn handle(&self) -> glow::Texture {
        self.id
    }
}

/// Allocate a 2D texture. `mips` allocates the full mip chain.
pub fn texture(
    gl: &glow::Context,
    w: i32,
    h: i32,
    internal: u32,
    format: u32,
    ty: u32,
    filter: Filter,
    wrap: Wrap,
    mips: bool,
    data: Option<&[u8]>,
) -> Result<Texture> {
    unsafe {
        let id = gl
            .create_texture()
            .map_err(|e| anyhow!("glCreateTexture: {e}"))?;
        gl.bind_texture(glow::TEXTURE_2D, Some(id));
        gl.pixel_store_i32(glow::UNPACK_ALIGNMENT, 1);
        gl.tex_image_2d(
            glow::TEXTURE_2D,
            0,
            internal as i32,
            w,
            h,
            0,
            format,
            ty,
            glow::PixelUnpackData::Slice(data),
        );
        gl.tex_parameter_i32(
            glow::TEXTURE_2D,
            glow::TEXTURE_WRAP_S,
            match wrap {
                Wrap::ClampEdge => glow::CLAMP_TO_EDGE,
                Wrap::ClampBorder => glow::CLAMP_TO_BORDER,
                Wrap::Repeat => glow::REPEAT,
            } as i32,
        );
        gl.tex_parameter_i32(
            glow::TEXTURE_2D,
            glow::TEXTURE_WRAP_T,
            match wrap {
                Wrap::ClampEdge => glow::CLAMP_TO_EDGE,
                Wrap::ClampBorder => glow::CLAMP_TO_BORDER,
                Wrap::Repeat => glow::REPEAT,
            } as i32,
        );
        if wrap == Wrap::ClampBorder {
            gl.tex_parameter_f32_slice(
                glow::TEXTURE_2D,
                glow::TEXTURE_BORDER_COLOR,
                &[0.0, 0.0, 0.0, 1.0],
            );
        }
        gl.tex_parameter_i32(
            glow::TEXTURE_2D,
            glow::TEXTURE_MIN_FILTER,
            match (filter, mips) {
                (Filter::Nearest, false) => glow::NEAREST,
                (Filter::Linear, false) => glow::LINEAR,
                (Filter::Nearest, true) => glow::NEAREST_MIPMAP_LINEAR,
                (Filter::Linear, true) => glow::LINEAR_MIPMAP_LINEAR,
            } as i32,
        );
        gl.tex_parameter_i32(
            glow::TEXTURE_2D,
            glow::TEXTURE_MAG_FILTER,
            match filter {
                Filter::Nearest => glow::NEAREST,
                Filter::Linear => glow::LINEAR,
            } as i32,
        );

        if mips {
            gl.generate_mipmap(glow::TEXTURE_2D);
        }
        gl.bind_texture(glow::TEXTURE_2D, None);
        Ok(Texture { id, w, h })
    }
}

pub fn upload_rgba(gl: &glow::Context, tex: &Texture, data: &[u8]) -> Result<()> {
    if data.len() < (tex.w * tex.h * 4) as usize {
        bail!("pixel buffer too small for texture");
    }
    unsafe {
        gl.bind_texture(glow::TEXTURE_2D, Some(tex.id));
        gl.tex_sub_image_2d(
            glow::TEXTURE_2D,
            0,
            0,
            0,
            tex.w,
            tex.h,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelUnpackData::Slice(Some(data)),
        );
        gl.generate_mipmap(glow::TEXTURE_2D);
        gl.bind_texture(glow::TEXTURE_2D, None);
    }
    Ok(())
}

pub struct Target {
    pub tex: Texture,
    pub fbo: glow::Framebuffer,
    pub mips: bool,
}

impl Target {
    pub fn new(
        gl: &glow::Context,
        w: i32,
        h: i32,
        internal: u32,
        format: u32,
        ty: u32,
        mips: bool,
    ) -> Result<Self> {
        let tex = texture(
            gl,
            w,
            h,
            internal,
            format,
            ty,
            Filter::Linear,
            Wrap::ClampBorder,
            mips,
            None,
        )?;
        unsafe {
            let fbo = gl
                .create_framebuffer()
                .map_err(|e| anyhow!("glCreateFramebuffer: {e}"))?;
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(fbo));
            gl.framebuffer_texture_2d(
                glow::FRAMEBUFFER,
                glow::COLOR_ATTACHMENT0,
                glow::TEXTURE_2D,
                Some(tex.id),
                0,
            );
            let status = gl.check_framebuffer_status(glow::FRAMEBUFFER);
            gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            if status != glow::FRAMEBUFFER_COMPLETE {
                bail!("incomplete framebuffer: {status:#x}");
            }
            Ok(Self { tex, fbo, mips })
        }
    }

    pub fn bind(&self, gl: &glow::Context) {
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(self.fbo));
            gl.viewport(0, 0, self.tex.w, self.tex.h);
        }
    }

    pub fn generate_mips(&self, gl: &glow::Context) {
        if !self.mips {
            return;
        }
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, None);
            gl.bind_texture(glow::TEXTURE_2D, Some(self.tex.id));
            gl.generate_mipmap(glow::TEXTURE_2D);
            gl.bind_texture(glow::TEXTURE_2D, None);
        }
    }
}

pub struct Quad {
    pub vao: glow::VertexArray,
    _vbo: glow::Buffer,
}

impl Quad {
    pub fn new(gl: &glow::Context) -> Result<Self> {
        unsafe {
            let vao = gl
                .create_vertex_array()
                .map_err(|e| anyhow!("glCreateVertexArray: {e}"))?;
            let vbo = gl
                .create_buffer()
                .map_err(|e| anyhow!("glCreateBuffer: {e}"))?;
            gl.bind_vertex_array(Some(vao));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(vbo));
            let verts: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
            let bytes = std::slice::from_raw_parts(
                verts.as_ptr() as *const u8,
                std::mem::size_of_val(&verts),
            );
            gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, bytes, glow::STATIC_DRAW);
            gl.enable_vertex_attrib_array(0);
            gl.vertex_attrib_pointer_f32(0, 2, glow::FLOAT, false, 0, 0);
            gl.bind_vertex_array(None);
            Ok(Self { vao, _vbo: vbo })
        }
    }

    pub fn draw(&self, gl: &glow::Context) {
        unsafe {
            gl.bind_vertex_array(Some(self.vao));
            gl.draw_arrays(glow::TRIANGLE_STRIP, 0, 4);
        }
    }
}

/// Bind a texture to a unit and its sampler uniform.
pub fn bind_texture(gl: &glow::Context, program: &Program, name: &str, unit: u32, tex: glow::Texture) {
    unsafe {
        gl.active_texture(glow::TEXTURE0 + unit);
        gl.bind_texture(glow::TEXTURE_2D, Some(tex));
    }
    program.sampler(gl, name, unit);
}

pub fn read_pixels(gl: &glow::Context, w: i32, h: i32) -> Vec<u8> {
    let mut buf = vec![0u8; (w * h * 4) as usize];
    unsafe {
        gl.read_pixels(
            0,
            0,
            w,
            h,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut buf)),
        );
    }
    buf
}

pub fn save_png(path: &std::path::Path, w: i32, h: i32, rgba_bottom_up: &[u8]) -> Result<()> {
    let row = (w * 4) as usize;
    let mut top_down = vec![0u8; row * h as usize];
    for y in 0..h as usize {
        let sy = h as usize - 1 - y;
        top_down[y * row..(y + 1) * row].copy_from_slice(&rgba_bottom_up[sy * row..(sy + 1) * row]);
    }
    let img = image::RgbaImage::from_raw(w as u32, h as u32, top_down)
        .ok_or_else(|| anyhow!("invalid screenshot buffer"))?;
    img.save(path)
        .with_context(|| format!("saving {}", path.display()))?;
    Ok(())
}
