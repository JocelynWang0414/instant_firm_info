// Company Info Extension - Google Cloud Vision Logo Detection
let tooltip = null;
let currentImg = null;
let fetchController = null;
let apiKeys = { google: null, brandfetch: null };
const processedImages = new WeakSet();
const cache = new Map();

// Load API keys
chrome.storage.sync.get(['googleApiKey', 'brandfetchKey'], (result) => {
  apiKeys.google = result.googleApiKey;
  apiKeys.brandfetch = result.brandfetchKey;
});

// Listen for API key updates
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.googleApiKey) apiKeys.google = changes.googleApiKey.newValue;
    if (changes.brandfetchKey) apiKeys.brandfetch = changes.brandfetchKey.newValue;
  }
});

// Create tooltip
function createTooltip() {
  const div = document.createElement('div');
  div.id = 'company-info-tooltip';
  div.className = 'company-tooltip-hidden';
  document.body.appendChild(div);
  return div;
}

tooltip = createTooltip();

// Check if image is likely a logo
function isLikelyLogo(img) {
  const src = img.src.toLowerCase();
  const alt = (img.alt || '').toLowerCase();
  const className = (img.className || '').toLowerCase();
  
  const logoKeywords = ['logo', 'brand', 'company', 'corp', 'trademark', 'icon'];
  const hasLogoKeyword = logoKeywords.some(keyword => 
    src.includes(keyword) || alt.includes(keyword) || className.includes(keyword)
  );
  
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const reasonableSize = width >= 40 && width <= 600 && height >= 40 && height <= 600;
  
  return hasLogoKeyword && reasonableSize;
}

// Convert image to base64
async function imageToBase64(img) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = Math.min(img.naturalWidth || img.width, 640);
    canvas.height = Math.min(img.naturalHeight || img.height, 640);
    
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';
    
    tempImg.onload = () => {
      ctx.drawImage(tempImg, 0, 0, canvas.width, canvas.height);
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        // Remove the data:image/jpeg;base64, prefix
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      } catch (e) {
        reject(e);
      }
    };
    
    tempImg.onerror = (e) => reject(e);
    tempImg.src = img.src;
  });
}

// Detect logo using Google Cloud Vision API
async function detectLogo(imageBase64) {
  if (!apiKeys.google) {
    return {
      error: true,
      message: 'API not configured. Click the extension icon to add your Google Cloud Vision API key.'
    };
  }
  
  try {
    const requestBody = {
      requests: [
        {
          image: {
            content: imageBase64
          },
          features: [
            {
              type: 'LOGO_DETECTION',
              maxResults: 5
            },
            {
              type: 'WEB_DETECTION',
              maxResults: 5
            }
          ]
        }
      ]
    };
    
    const response = await fetch(
      \`https://vision.googleapis.com/v1/images:annotate?key=\${apiKeys.google}\`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Vision API request failed');
    }
    
    const data = await response.json();
    const result = data.responses[0];
    
    // Check for logo annotations
    if (result.logoAnnotations && result.logoAnnotations.length > 0) {
      const topLogo = result.logoAnnotations[0];
      return {
        success: true,
        brandName: topLogo.description,
        confidence: topLogo.score,
        source: 'Logo Detection'
      };
    }
    
    // Fallback to web detection if no logo found
    if (result.webDetection?.webEntities && result.webDetection.webEntities.length > 0) {
      const topEntity = result.webDetection.webEntities.find(e => e.description && e.score > 0.5);
      if (topEntity) {
        return {
          success: true,
          brandName: topEntity.description,
          confidence: topEntity.score,
          source: 'Web Detection'
        };
      }
    }
    
    return {
      error: true,
      message: 'No logo detected in this image'
    };
    
  } catch (error) {
    console.error('Logo detection error:', error);
    return {
      error: true,
      message: error.message || 'Failed to detect logo'
    };
  }
}

// Extract domain from brand name (simple heuristic)
function brandNameToDomain(brandName) {
  // Clean up brand name
  const cleaned = brandName.toLowerCase()
    .replace(/[^a-z0-9\\s]/g, '')
    .replace(/\\s+/g, '')
    .trim();
  
  // Common domain patterns
  return \`\${cleaned}.com\`;
}

// Get company info from Brandfetch
async function getCompanyInfoFromBrandfetch(domain) {
  if (!apiKeys.brandfetch || !domain) {
    return null;
  }
  
  try {
    const response = await fetch(
      \`https://api.brandfetch.io/v2/brands/\${encodeURIComponent(domain)}\`,
      {
        headers: {
          'Authorization': \`Bearer \${apiKeys.brandfetch}\`
        }
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    
    return {
      name: data.name,
      description: data.description,
      industry: data.industry,
      location: data.headquarters?.country,
      founded: data.founded,
      employees: data.employeeRange,
      domain: data.domain
    };
  } catch (error) {
    console.error('Brandfetch error:', error);
    return null;
  }
}

// Main function to get company info
async function getCompanyInfo(img) {
  const cacheKey = img.src;
  
  // Check cache
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  
  if (fetchController) {
    fetchController.abort();
  }
  
  fetchController = new AbortController();
  
  try {
    // Convert image to base64
    const imageBase64 = await imageToBase64(img);
    
    // Detect logo using Google Cloud Vision
    const logoResult = await detectLogo(imageBase64);
    
    if (logoResult.error) {
      const errorInfo = {
        error: true,
        name: 'Detection Failed',
        message: logoResult.message
      };
      cache.set(cacheKey, errorInfo);
      return errorInfo;
    }
    
    const brandName = logoResult.brandName;
    const confidence = Math.round((logoResult.confidence || 0) * 100);
    
    // Try to get domain
    const estimatedDomain = brandNameToDomain(brandName);
    
    // Try to get detailed info from Brandfetch
    let detailedInfo = await getCompanyInfoFromBrandfetch(estimatedDomain);
    
    // If Brandfetch fails, try common variations
    if (!detailedInfo) {
      const variations = [
        brandName.toLowerCase().replace(/\\s+/g, '') + '.com',
        brandName.toLowerCase().replace(/\\s+/g, '-') + '.com',
        brandName.toLowerCase().split(' ')[0] + '.com'
      ];
      
      for (const variation of variations) {
        detailedInfo = await getCompanyInfoFromBrandfetch(variation);
        if (detailedInfo) break;
      }
    }
    
    // Compile final info
    const info = {
      name: detailedInfo?.name || brandName,
      business: detailedInfo?.description || \`Detected as \${brandName} logo with \${confidence}% confidence\`,
      domain: detailedInfo?.domain || estimatedDomain,
      location: detailedInfo?.location,
      industry: detailedInfo?.industry,
      founded: detailedInfo?.founded,
      employees: detailedInfo?.employees,
      confidence: confidence,
      source: logoResult.source + (detailedInfo ? ' + Brandfetch' : ''),
      detectionMethod: logoResult.source
    };
    
    cache.set(cacheKey, info);
    return info;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      return null;
    }
    console.error('Error getting company info:', error);
    const errorInfo = {
      error: true,
      name: 'Error',
      message: 'Failed to process image. The image may not be accessible due to CORS restrictions.'
    };
    cache.set(cacheKey, errorInfo);
    return errorInfo;
  }
}

// Show tooltip
async function showTooltip(img, x, y) {
  currentImg = img;
  
  tooltip.className = 'company-tooltip-visible';
  tooltip.innerHTML = \`
    <div class="tooltip-loading">
      <div class="loading-spinner"></div>
      <div>Detecting logo...</div>
    </div>
  \`;
  
  positionTooltip(x, y);
  
  const info = await getCompanyInfo(img);
  
  if (currentImg === img && info) {
    if (info.error) {
      tooltip.innerHTML = \`
        <div class="tooltip-content">
          <h3 style="color: #d32f2f;">⚠️ \${info.name}</h3>
          <div class="tooltip-section">
            <p>\${info.message}</p>
          </div>
        </div>
      \`;
    } else {
      tooltip.innerHTML = \`
        <div class="tooltip-content">
          <h3>\${info.name}</h3>
          \${info.confidence ? \`
            <div class="confidence-badge">
              Confidence: \${info.confidence}%
            </div>
          \` : ''}
          <div class="tooltip-section">
            <strong>Business:</strong>
            <p>\${info.business}</p>
          </div>
          \${info.domain ? \`
            <div class="tooltip-section">
              <strong>Website:</strong> <a href="https://\${info.domain}" target="_blank" style="color: #1a73e8;">\${info.domain}</a>
            </div>
          \` : ''}
          \${info.industry ? \`
            <div class="tooltip-section">
              <strong>Industry:</strong> \${info.industry}
            </div>
          \` : ''}
          \${info.location ? \`
            <div class="tooltip-section">
              <strong>Location:</strong> \${info.location}
            </div>
          \` : ''}
          \${info.founded ? \`
            <div class="tooltip-section">
              <strong>Founded:</strong> \${info.founded}
            </div>
          \` : ''}
          \${info.employees ? \`
            <div class="tooltip-section">
              <strong>Employees:</strong> \${info.employees}
            </div>
          \` : ''}
          <div class="tooltip-footer">
            <small>Source: \${info.source}</small>
          </div>
        </div>
      \`;
    }
    positionTooltip(x, y);
  }
}

// Position tooltip
function positionTooltip(x, y) {
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = x + 15;
  let top = y + 15;
  
  if (left + tooltipRect.width > viewportWidth) {
    left = x - tooltipRect.width - 15;
  }
  
  if (top + tooltipRect.height > viewportHeight) {
    top = y - tooltipRect.height - 15;
  }
  
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
}

// Hide tooltip
function hideTooltip() {
  tooltip.className = 'company-tooltip-hidden';
  currentImg = null;
  if (fetchController) {
    fetchController.abort();
    fetchController = null;
  }
}

// Event listeners
let hoverTimeout;

document.addEventListener('mouseover', (e) => {
  if (e.target.tagName === 'IMG' && !processedImages.has(e.target)) {
    if (isLikelyLogo(e.target)) {
      processedImages.add(e.target);
      
      e.target.addEventListener('mouseenter', function(event) {
        clearTimeout(hoverTimeout);
        hoverTimeout = setTimeout(() => {
          showTooltip(this, event.pageX, event.pageY);
        }, 500);
      });
      
      e.target.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
        hideTooltip();
      });
      
      e.target.addEventListener('mousemove', (event) => {
        if (tooltip.className === 'company-tooltip-visible') {
          positionTooltip(event.pageX, event.pageY);
        }
      });
    }
  }
});

document.addEventListener('scroll', hideTooltip);
