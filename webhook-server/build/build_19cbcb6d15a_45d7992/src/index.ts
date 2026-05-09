import { Hono } from 'hono'
import { serve } from '@hono/node-server'

const app = new Hono()

const landingPage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Final Cut | Premium Barber Shop</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --gold: #C9A962;
      --gold-dark: #A88B4A;
      --black: #0D0D0D;
      --charcoal: #1A1A1A;
      --cream: #F5F0E8;
      --white: #FFFFFF;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', sans-serif;
      background: var(--black);
      color: var(--cream);
      line-height: 1.6;
    }

    /* Header */
    header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      background: rgba(13, 13, 13, 0.95);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(201, 169, 98, 0.2);
    }

    .nav-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 48px;
      height: 48px;
      position: relative;
    }

    .logo-icon svg {
      width: 100%;
      height: 100%;
    }

    .logo-text {
      font-family: 'Playfair Display', serif;
      font-size: 1.5rem;
      font-weight: 900;
      color: var(--gold);
      letter-spacing: 1px;
    }

    .logo-text span {
      color: var(--white);
    }

    nav {
      display: flex;
      gap: 2rem;
    }

    nav a {
      color: var(--cream);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: color 0.3s;
    }

    nav a:hover {
      color: var(--gold);
    }

    /* Hero Section */
    .hero {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: 
        linear-gradient(to bottom, rgba(13, 13, 13, 0.7), rgba(13, 13, 13, 0.9)),
        url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="%23C9A962" stroke-width="0.3" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
      padding: 6rem 2rem;
    }

    .hero-content {
      text-align: center;
      max-width: 800px;
    }

    .hero-badge {
      display: inline-block;
      padding: 0.5rem 1.5rem;
      background: rgba(201, 169, 98, 0.15);
      border: 1px solid var(--gold);
      color: var(--gold);
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 2rem;
    }

    .hero h1 {
      font-family: 'Playfair Display', serif;
      font-size: clamp(3rem, 8vw, 5rem);
      font-weight: 900;
      line-height: 1.1;
      margin-bottom: 1.5rem;
    }

    .hero h1 .accent {
      color: var(--gold);
    }

    .hero p {
      font-size: 1.125rem;
      color: rgba(245, 240, 232, 0.7);
      max-width: 500px;
      margin: 0 auto 2.5rem;
    }

    .cta-button {
      display: inline-block;
      padding: 1rem 2.5rem;
      background: var(--gold);
      color: var(--black);
      font-weight: 600;
      font-size: 1rem;
      text-decoration: none;
      border: none;
      cursor: pointer;
      transition: all 0.3s;
    }

    .cta-button:hover {
      background: var(--gold-dark);
      transform: translateY(-2px);
    }

    /* Decorative line */
    .divider {
      width: 60px;
      height: 2px;
      background: var(--gold);
      margin: 2rem auto;
    }

    /* Testimonials Section */
    .testimonials {
      padding: 6rem 2rem;
      background: var(--charcoal);
    }

    .section-container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: 4rem;
    }

    .section-header h2 {
      font-family: 'Playfair Display', serif;
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 1rem;
    }

    .section-header p {
      color: rgba(245, 240, 232, 0.6);
    }

    .testimonials-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 2rem;
    }

    .testimonial-card {
      background: var(--black);
      padding: 2rem;
      border: 1px solid rgba(201, 169, 98, 0.2);
      transition: border-color 0.3s;
    }

    .testimonial-card:hover {
      border-color: var(--gold);
    }

    .testimonial-stars {
      color: var(--gold);
      font-size: 1.25rem;
      margin-bottom: 1rem;
      letter-spacing: 4px;
    }

    .testimonial-text {
      font-size: 1rem;
      color: var(--cream);
      margin-bottom: 1.5rem;
      font-style: italic;
    }

    .testimonial-author {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .testimonial-avatar {
      width: 48px;
      height: 48px;
      background: var(--gold);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: var(--black);
    }

    .testimonial-name {
      font-weight: 600;
      color: var(--white);
    }

    .testimonial-title {
      font-size: 0.85rem;
      color: rgba(245, 240, 232, 0.5);
    }

    /* Contact Section */
    .contact {
      padding: 6rem 2rem;
      background: var(--black);
    }

    .contact-wrapper {
      max-width: 600px;
      margin: 0 auto;
    }

    .contact-form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-group label {
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--cream);
    }

    .form-group input,
    .form-group textarea {
      padding: 1rem;
      background: var(--charcoal);
      border: 1px solid rgba(201, 169, 98, 0.2);
      color: var(--cream);
      font-family: 'Inter', sans-serif;
      font-size: 1rem;
      transition: border-color 0.3s;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: var(--gold);
    }

    .form-group textarea {
      min-height: 150px;
      resize: vertical;
    }

    .submit-button {
      padding: 1rem 2rem;
      background: var(--gold);
      color: var(--black);
      font-weight: 600;
      font-size: 1rem;
      border: none;
      cursor: pointer;
      transition: all 0.3s;
    }

    .submit-button:hover {
      background: var(--gold-dark);
    }

    /* Footer */
    footer {
      padding: 2rem;
      text-align: center;
      border-top: 1px solid rgba(201, 169, 98, 0.2);
      color: rgba(245, 240, 232, 0.5);
      font-size: 0.9rem;
    }

    @media (max-width: 768px) {
      nav {
        display: none;
      }
      
      .hero h1 {
        font-size: 2.5rem;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="nav-container">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="22" stroke="#C9A962" stroke-width="2"/>
            <path d="M16 14C16 14 20 20 24 20C28 20 32 14 32 14" stroke="#C9A962" stroke-width="2" stroke-linecap="round"/>
            <path d="M18 28C18 28 21 32 24 32C27 32 30 28 30 28" stroke="#C9A962" stroke-width="2" stroke-linecap="round"/>
            <circle cx="24" cy="18" r="2" fill="#C9A962"/>
          </svg>
        </div>
        <span class="logo-text">The <span>Final</span> Cut</span>
      </div>
      <nav>
        <a href="#testimonials">Reviews</a>
        <a href="#contact">Contact</a>
      </nav>
    </div>
  </header>

  <section class="hero">
    <div class="hero-content">
      <span class="hero-badge">Premium Grooming Experience</span>
      <h1>The <span class="accent">Final</span> Cut</h1>
      <p>Where classic craftsmanship meets modern style. Experience the art of traditional barbering in an atmosphere of refined elegance.</p>
      <a href="#contact" class="cta-button">Book Your Appointment</a>
    </div>
  </section>

  <section class="testimonials" id="testimonials">
    <div class="section-container">
      <div class="section-header">
        <h2>What Our Clients Say</h2>
        <div class="divider"></div>
        <p>Join hundreds of satisfied gentlemen who trust us with their look</p>
      </div>
      <div class="testimonials-grid">
        <div class="testimonial-card">
          <div class="testimonial-stars">★★★★★</div>
          <p class="testimonial-text">"Best barbershop in the city. The attention to detail is unmatched. I always leave looking and feeling my best."</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar">JD</div>
            <div>
              <div class="testimonial-name">James Davidson</div>
              <div class="testimonial-title">Regular Client</div>
            </div>
          </div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-stars">★★★★★</div>
          <p class="testimonial-text">"The atmosphere is incredible—classic vibes with a modern touch. My go-to place for the perfect cut."</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar">MR</div>
            <div>
              <div class="testimonial-name">Marcus Reynolds</div>
              <div class="testimonial-title">Regular Client</div>
            </div>
          </div>
        </div>
        <div class="testimonial-card">
          <div class="testimonial-stars">★★★★★</div>
          <p class="testimonial-text">"Been coming here for years. Consistent quality and professional service every single time."</p>
          <div class="testimonial-author">
            <div class="testimonial-avatar">TC</div>
            <div>
              <div class="testimonial-name">Thomas Chen</div>
              <div class="testimonial-title">Regular Client</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="contact" id="contact">
    <div class="section-container">
      <div class="section-header">
        <h2>Get In Touch</h2>
        <div class="divider"></div>
        <p>Ready for your next cut? Send us a message</p>
      </div>
      <div class="contact-wrapper">
        <form class="contact-form" onsubmit="handleSubmit(event)">
          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" required>
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required>
          </div>
          <div class="form-group">
            <label for="message">Message</label>
            <textarea id="message" name="message" required></textarea>
          </div>
          <button type="submit" class="submit-button">Send Message</button>
        </form>
      </div>
    </div>
  </section>

  <footer>
    <p>&copy; 2026 The Final Cut. All rights reserved.</p>
  </footer>

  <script>
    function handleSubmit(e) {
      e.preventDefault();
      alert('Thank you for your message! We will be in touch soon.');
    }
  </script>
</body>
</html>
`

app.get('/api/build/preview/*', (c) => {
  return c.html(landingPage)
})

app.get('/', (c) => {
  return c.redirect('/api/build/preview/build_19cbcb6d15a_45d7992')
})

serve({
  fetch: app.fetch,
  port: 4097,
})
