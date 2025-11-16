import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Advanced element finder with multiple strategies
const findButton = async (page, texts) => {
  try {
    // Strategy 1: Find by text content
    for (const text of texts) {
      const button = await page.evaluate((searchText) => {
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
        return buttons.find(btn => {
          const content = (btn.textContent || btn.innerText || '').trim().toLowerCase();
          return content.includes(searchText.toLowerCase());
        });
      }, text);
      
      if (button) {
        const element = await page.evaluateHandle((txt) => {
          const btns = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'));
          return btns.find(b => (b.textContent || '').toLowerCase().includes(txt.toLowerCase()));
        }, text);
        return element.asElement();
      }
    }

    // Strategy 2: Find by class/id patterns
    const classPatterns = [
      'button[class*="restart" i]',
      'button[class*="start" i]',
      'a[class*="restart" i]',
      'div[class*="restart" i][role="button"]',
      '#restart-button',
      '#start-button'
    ];
    
    for (const selector of classPatterns) {
      const btn = await page.$(selector);
      if (btn) return btn;
    }

    // Strategy 3: Find by aria-label
    const ariaBtn = await page.$('button[aria-label*="restart" i], button[aria-label*="start" i]');
    if (ariaBtn) return ariaBtn;

    return null;
  } catch (error) {
    console.log("⚠️ Button search error:", error.message);
    return null;
  }
};

(async () => {
  const browser = await puppeteer.launch({ 
    headless: false, 
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();

  console.log("🔵 Aternos login ho raha hai...");
  await page.goto("https://aternos.org/go/", { waitUntil: "networkidle2", timeout: 60000 });

  // Login
  await wait(2000);
  await page.type('input[autocomplete="username"], input[type="text"]', process.env.ATERNOS_USERNAME);
  await page.type('input[type="password"]', process.env.ATERNOS_PASSWORD);

  // Find and click login button
  const loginBtn = await findButton(page, ["sign in", "login", "log in"]);
  if (!loginBtn) {
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
  } else {
    await loginBtn.click();
  }

  console.log("✅ Login successful");
  await wait(5000);
  
  console.log("📌 Server page load ho raha hai...");
  console.log("🔄 Auto-restart monitoring shuru...\n");

  // Auto-restart monitoring loop
  while (true) {
    await wait(8000);

    // Get player count
    const playerText = await page.evaluate(() => {
      const patterns = [
        /(\d+)\s*\/\s*\d+/,           // "0/20" pattern
        /Players?:\s*(\d+)/i,          // "Players: 0"
        /Online:\s*(\d+)/i             // "Online: 0"
      ];
      
      const bodyText = document.body.innerText;
      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) return match[1];
      }
      
      // Check specific elements
      const selectors = ['.players', '.player-count', '[class*="player"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText || el.textContent;
          const match = text.match(/(\d+)/);
          if (match) return match[1];
        }
      }
      
      return "0";
    }).catch(() => "0");

    const playerCount = parseInt(playerText) || 0;

    // Get timer
    const timer = await page.evaluate(() => {
      const allElements = document.querySelectorAll('span, div, p');
      for (const el of allElements) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text.match(/^\d{1,2}:\d{2}$/)) {
          return text;
        }
      }
      return null;
    }).catch(() => null);

    // Parse timer
    let timerDisplay = "N/A";
    let secondsRemaining = null;
    
    if (timer) {
      const match = timer.match(/^(\d{1,2}):(\d{2})$/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        secondsRemaining = minutes * 60 + seconds;
        
        if (minutes > 0) {
          timerDisplay = `${minutes}m ${seconds}s`;
        } else {
          timerDisplay = `${seconds}s`;
        }
      }
    }

    console.log(`👥 Players: ${playerCount} | ⏱️  Timer: ${timerDisplay}`);

    // Check restart conditions
    const shouldRestart = (
      playerCount === 0 && 
      secondsRemaining !== null && 
      secondsRemaining <= 30 && 
      secondsRemaining > 0
    );

    if (shouldRestart) {
      console.log(`\n🚨 AUTO-RESTART TRIGGERED! (${secondsRemaining}s bacha, 0 players)`);
      
      // Try to find restart/start button
      const actionBtn = await findButton(page, ["restart", "start", "confirm"]);
      
      if (actionBtn) {
        try {
          // Scroll button into view
          await page.evaluate(btn => {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, actionBtn);
          
          await wait(500);
          
          // Click the button
          await actionBtn.click();
          console.log("✅ Button clicked successfully!");
          
          await wait(3000);
          
          // Check for confirmation dialog
          const confirmBtn = await findButton(page, ["confirm", "yes", "ok", "restart"]);
          if (confirmBtn) {
            await confirmBtn.click();
            console.log("✅ Confirmation clicked!");
          }
          
          console.log("⏳ Server restart ho raha hai...\n");
          await wait(15000);
          
        } catch (error) {
          console.log("❌ Click error:", error.message);
        }
      } else {
        console.log("⚠️ Restart button nahi mila! Page screenshot le raha hoon...");
        await page.screenshot({ path: 'debug-screenshot.png' });
        console.log("📸 Screenshot saved: debug-screenshot.png\n");
      }
    } else if (playerCount > 0) {
      console.log("✅ Players online → Safe (no restart)\n");
    } else if (!timer) {
      console.log("⚠️ Timer detect nahi ho raha\n");
    } else if (secondsRemaining > 30) {
      console.log(`✅ Timer safe (${secondsRemaining}s > 30s)\n`);
    }
  }
})();