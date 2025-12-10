// 增强版粒子系统
const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');

let width, height;
let particles = [];

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = (Math.random() - 0.5) * 0.5;
        this.size = Math.random() * 3;
        this.life = Math.random() * 100;
        this.maxLife = 100 + Math.random() * 100;
        // 随机颜色：青色、粉色、白色
        const colors = ['rgba(0, 242, 255, ', 'rgba(255, 0, 85, ', 'rgba(255, 255, 255, '];
        this.baseColor = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life++;

        if (this.life > this.maxLife || this.x < 0 || this.x > width || this.y < 0 || this.y > height) {
            this.reset();
            this.life = 0;
        }
    }

    draw() {
        const opacity = Math.sin((this.life / this.maxLife) * Math.PI) * 0.6;
        ctx.fillStyle = this.baseColor + opacity + ')';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        
        // 发光效果
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.baseColor + '1)';
    }
}

for(let i = 0; i < 80; i++) particles.push(new Particle());

function animate() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach(p => {
        p.update();
        p.draw();
    });
    ctx.shadowBlur = 0; // 重置阴影以免影响性能
    requestAnimationFrame(animate);
}
animate();



