// Load saved API keys
chrome.storage.sync.get(['googleApiKey', 'brandfetchKey'], (result) => {
  if (result.googleApiKey) {
    document.getElementById('googleApiKey').value = result.googleApiKey;
  }
  if (result.brandfetchKey) {
    document.getElementById('brandfetchKey').value = result.brandfetchKey;
  }
});

// Save configuration
document.getElementById('saveBtn').addEventListener('click', () => {
  const googleApiKey = document.getElementById('googleApiKey').value.trim();
  const brandfetchKey = document.getElementById('brandfetchKey').value.trim();
  const statusDiv = document.getElementById('status');
  
  if (!googleApiKey) {
    statusDiv.textContent = 'Google Cloud Vision API Key is required';
    statusDiv.className = 'status error';
    statusDiv.style.display = 'block';
    return;
  }
  
  chrome.storage.sync.set({ 
    googleApiKey, 
    brandfetchKey 
  }, () => {
    statusDiv.textContent = 'Configuration saved successfully!';
    statusDiv.className = 'status success';
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  });
});
