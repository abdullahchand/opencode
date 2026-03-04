# The Gentleman Cut - Barber Landing Page Specification

## Project Overview
- **Project Name**: The Gentleman Cut
- **Type**: Single-page landing website
- **Core Functionality**: A sophisticated barber shop landing page with header, hero, testimonials, and contact form
- **Target Users**: Men seeking premium barber services

## UI/UX Specification

### Color Palette
- **Primary (Gold)**: `#C9A227`
- **Primary Hover**: `#D4B54A`
- **Background Dark**: `#1A1A1A`
- **Background Darker**: `#121212`
- **Background Card**: `#242424`
- **Text Primary**: `#FFFFFF`
- **Text Secondary**: `#B0B0B0`
- **Text Muted**: `#707070`

### Typography
- **Font Family**: "Outfit" (Google Fonts) - modern, clean geometric sans-serif
- **Logo**: 700 weight, 1.75rem
- **Navigation**: 500 weight, 1rem
- **Hero Headline**: 800 weight, clamp(2.5rem, 6vw, 4.5rem)
- **Hero Subtext**: 400 weight, 1.25rem
- **Section Titles**: 700 weight, clamp(2rem, 4vw, 3rem)
- **Body Text**: 400 weight, 1rem
- **Testimonials**: 400 weight, 1.1rem, italic

### Spacing System
- **Section Padding**: 6rem vertical, 1.5rem horizontal
- **Container Max Width**: 1200px
- **Component Gap**: 2rem
- **Card Padding**: 2.5rem

### Layout Structure
1. **Header**: Fixed, transparent → solid on scroll
   - Logo: Text "THE GENTLEMAN CUT" with scissors icon (✂)
   - Navigation: Home, Services, Testimonials, Contact
   - CTA Button: "Book Now"

2. **Hero Section**: Full viewport height
   - Background: Dark with subtle barber pole diagonal pattern
   - Tagline: "EST. 2018" with gold accent line
   - Headline: "Where Style Meets Tradition"
   - Subtext: "Premium cuts, hot shaves, and timeless grooming in the heart of the city"
   - CTA: "Book Your Appointment"

3. **Testimonials Section**: 3 cards in grid
   - Dark card backgrounds with gold left border accent
   - Quote text, customer name, star rating (5 stars)
   - Staggered fade-in animation on scroll

4. **Contact Form Section**: Dark background
   - Title: "Book Your Appointment"
   - Subtitle: "Fill out the form and we'll get back to you"
   - Form Fields: Name, Email, Phone, Message (textarea)
   - Submit Button: Gold background, dark text

### Responsive Breakpoints
- **Desktop**: > 1024px
- **Tablet**: 768px - 1024px
- **Mobile**: < 768px

### Visual Effects
- **Header**: backdrop-filter blur, transparent → solid background on scroll
- **Cards**: Subtle box-shadow, gold left border on testimonials
- **Buttons**: Scale up slightly on hover, color transition
- **Form Inputs**: Dark background, gold border on focus
- **Animations**: 
  - Hero content fade-in-up on load
  - Testimonial cards fade-in-up with stagger
  - Smooth scroll behavior
  - Section reveal on scroll (Intersection Observer)

## Functionality Specification

### Core Features
1. **Smooth Scroll Navigation**: Click nav links to smooth scroll to sections
2. **Header Scroll Effect**: Background becomes solid after scrolling 100px
3. **Mobile Menu**: Hamburger toggle for mobile navigation
4. **Form Validation**: HTML5 required fields
5. **Scroll Animations**: Elements animate in when entering viewport

### User Interactions
- Hover states on all interactive elements
- Focus states on form inputs
- Mobile menu open/close

### Edge Cases
- Long testimonial text wraps properly
- Form validates required fields
- Mobile menu closes on link click

## Acceptance Criteria
- [ ] Header is fixed and transitions on scroll
- [ ] Logo displays with scissors icon
- [ ] Navigation links scroll smoothly to sections
- [ ] Hero section fills viewport with proper typography
- [ ] 3 testimonial cards display with gold accent
- [ ] Contact form has all 4 fields plus submit button
- [ ] All colors match spec exactly
- [ ] Page is fully responsive on mobile
- [ ] Animations are smooth and performant
- [ ] No console errors
