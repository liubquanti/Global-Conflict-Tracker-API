const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { JSDOM } = require('jsdom');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json());

app.get('/api/conflicts', async (req, res) => {
  try {
    let featuresData;
    
    try {
      const cachedDataPath = path.join(__dirname, 'cache', 'conflict_data.json');
      const cachedData = await fs.readFile(cachedDataPath, 'utf-8');
      featuresData = JSON.parse(cachedData);
      
      const cacheStats = await fs.stat(cachedDataPath);
      const cacheTime = new Date(cacheStats.mtime).getTime();
      const currentTime = new Date().getTime();
      const cacheAge = (currentTime - cacheTime) / (1000 * 60 * 60);
      
      if (cacheAge < 24) {
        return res.status(200).json({
          source: 'cache',
          lastUpdated: new Date(cacheStats.mtime).toISOString(),
          data: featuresData
        });
      }
    } catch (error) {
      console.log('No valid cache found or cache expired. Fetching fresh data...');
    }
    
    const response = await axios.get('https://www.cfr.org/global-conflict-tracker', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const html = response.data;
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const scriptElement = document.querySelector('script[data-drupal-selector="drupal-settings-json"]');
    
    if (!scriptElement) {
      throw new Error('Could not find the drupal-settings-json script tag');
    }
    
    const rawData = JSON.parse(scriptElement.textContent);
    
    if (rawData && rawData['gct-map'] && rawData['gct-map'].gct_data && rawData['gct-map'].gct_data.features) {
      featuresData = {
        type: "FeatureCollection",
        features: rawData['gct-map'].gct_data.features
      };
      
      try {
        await fs.mkdir(path.join(__dirname, 'cache'), { recursive: true });
        await fs.writeFile(
          path.join(__dirname, 'cache', 'conflict_data.json'),
          JSON.stringify(featuresData, null, 2)
        );
      } catch (cacheError) {
        console.error('Error writing cache:', cacheError);
      }
      
      return res.status(200).json({
        source: 'live',
        lastUpdated: new Date().toISOString(),
        data: featuresData
      });
    } else {
      throw new Error('Features data not found in the response');
    }
  } catch (error) {
    console.error('Error fetching conflict data:', error);
    
    try {
      const backupData = await fs.readFile(path.join(__dirname, 'data', 'backup_data.json'), 'utf-8');
      const parsedBackupData = JSON.parse(backupData);
      
      return res.status(200).json({
        source: 'backup',
        lastUpdated: 'unknown',
        error: error.message,
        data: parsedBackupData
      });
    } catch (backupError) {
      return res.status(500).json({
        error: 'Failed to fetch conflict data and no backup available',
        details: error.message
      });
    }
  }
});

app.get('/api/status', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Global Conflict Tracker API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Global Conflict Tracker API running on port ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});