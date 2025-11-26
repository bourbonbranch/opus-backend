// const fetch = require('node-fetch'); // Native fetch in Node 18+

async function debugCampaignCreation() {
    const API_URL = 'https://opus-backend-production.up.railway.app';
    // const API_URL = 'http://localhost:8080'; // Uncomment to test local if needed

    const payload = {
        director_id: 64, // Using a known ID, or I should try to find one
        ensemble_id: null, // Test with null ensemble first
        name: "Debug Campaign " + Date.now(),
        description: "Debugging creation",
        goal_amount_cents: 10000,
        per_student_goal_cents: 5000,
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 86400000).toISOString()
    };

    console.log('Sending payload:', JSON.stringify(payload, null, 2));

    try {
        const response = await fetch(`${API_URL}/api/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const status = response.status;
        const text = await response.text();

        console.log(`Response Status: ${status}`);
        console.log(`Response Body: ${text}`);

        if (!response.ok) {
            console.error('❌ Request failed');
        } else {
            console.log('✅ Request successful');
        }

    } catch (err) {
        console.error('❌ Network or script error:', err);
    }
}

debugCampaignCreation();
