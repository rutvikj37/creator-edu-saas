import { Award, BadgePercent, BarChart3, BookOpen, CalendarClock, CreditCard, Crown, FileText, Globe, Lock, MessagesSquare, Radio, Receipt, Megaphone, Download } from 'lucide-react';

/** Only what the product actually does today. */
export const PILLARS = [
  { icon: BookOpen, title: 'Courses that finish', text: 'Structure lessons with video, PDFs, quizzes and assignments. Drip content, track progress and issue verifiable certificates automatically.', tone: 'from-indigo-500 to-violet-500', wide: true },
  { icon: Globe, title: 'Your brand, your domain', text: 'A website for your academy on your own domain, in your colours, with a page builder for landing pages.', tone: 'from-fuchsia-500 to-pink-500', wide: true },
  { icon: Radio, title: 'Live classes', text: 'Schedule classes, take attendance, chat with learners and share the recording afterwards.', tone: 'from-rose-500 to-orange-400' },
  { icon: CalendarClock, title: '1:1 coaching', text: 'Sell coaching programs. Learners pick a slot from your working hours and get a Google Meet link.', tone: 'from-emerald-500 to-teal-400' },
  { icon: CreditCard, title: 'Payments built in', text: 'Collect with UPI, cards, net banking and wallets through your own Razorpay account. Money settles to your bank, not ours.', tone: 'from-sky-500 to-cyan-400' },
];

export const MORE = [
  { icon: Crown, title: 'Memberships', text: 'Recurring or lifetime plans that unlock a community.' },
  { icon: Download, title: 'Digital products', text: 'Sell e-books, templates and bundles alongside courses.' },
  { icon: Receipt, title: 'GST invoicing', text: 'Tax-ready invoices with your GSTIN and your own numbering.' },
  { icon: BadgePercent, title: 'Coupons & affiliates', text: 'Discount codes, payment links and a partner program.' },
  { icon: Megaphone, title: 'Email & WhatsApp', text: 'Campaigns and automatic reminders to bring learners back.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales, learner activity and bandwidth, with exports.' },
  { icon: Lock, title: 'Content protection', text: 'Device limits and learner watermarks on video and PDFs.' },
  { icon: MessagesSquare, title: 'Chat & community', text: 'Answer learners in one inbox and run discussion spaces.' },
  { icon: Award, title: 'Certificates', text: 'Branded certificates anyone can verify with a link.' },
  { icon: FileText, title: 'Offline sales', text: 'Record cash and bank transfers so your books stay complete.' },
];

export const STEPS = [
  { title: 'Create your academy', text: 'Sign up with your name and email. Your academy gets its own address straight away.' },
  { title: 'Add what you teach', text: 'Upload a course, schedule a live class or open a coaching program, then set a price.' },
  { title: 'Connect payments and share', text: 'Link your Razorpay account, publish, and send your link to your audience.' },
];

export function faqs({ name, trialDays }) {
  return [
    { q: `What is ${name}?`, a: `${name} is an all-in-one platform for teachers, coaches and institutes to build an online academy: host courses, run live classes and 1:1 coaching, sell memberships and digital products, and collect payments under your own brand.` },
    { q: 'Do I need a credit card to start?', a: trialDays > 0 ? `No. You sign up with your name and email and get a ${trialDays}-day free trial. You only choose a paid plan when you decide to continue.` : 'No. You sign up with your name and email. You only pay when you choose a paid plan.' },
    { q: 'How do I get paid?', a: 'You connect your own Razorpay account. Learners pay with UPI, cards, net banking or wallets and the money settles directly to your bank account on Razorpay’s schedule.' },
    { q: 'Can I use my own domain name?', a: 'Yes, on plans that include custom domains. Until then your academy is live on a free address on our domain, and you can switch at any time.' },
    { q: 'Is my content protected?', a: 'Videos are streamed rather than offered as downloads, you can limit how many devices a learner signs in on, and videos and PDFs can carry the learner’s details as a watermark.' },
    { q: 'What happens to my learners if I stop paying?', a: 'Your academy stays online and learners keep access to what they bought. Creating new courses and taking new payments is paused until you choose a plan.' },
    { q: 'Can I issue GST invoices?', a: 'Yes. Add your GSTIN and business details once, and every sale generates a tax invoice in your own number series.' },
  ];
}
