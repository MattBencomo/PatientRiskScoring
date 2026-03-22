const { get } = require('http');
const https = require('https');

// constants
const API_KEY = 'ak_48b2c53ae2bf373bd3a2184c71e1dcde72a755425165b5c3';
const BASE_URL = 'assessment.ksensetech.com';

function getSinglePage(page, limit, retries = 3) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: BASE_URL,
            path: `/api/patients?page=${page}&limit=${limit}`,
            method: 'GET',
            headers: {
                'x-api-key': `${API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 500 || res.statusCode === 503) {
                if (retries > 0) {
                    setTimeout(() => {
                        resolve(getSinglePage(page, limit, retries - 1));
                    }, 1000 * (4 - retries)); // Exponential backoff: 3s, 2s, 1s
                } else {
                    reject(new Error(`Failed after retries: ${res.statusCode}`));
                }
            } else if (res.statusCode >= 200 && res.statusCode < 300) {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => { resolve(JSON.parse(data)); });
            } else reject(new Error(`HTTP ${res.statusCode}`));
            
        });
        req.on('error', reject);
        req.end();
    });
}

function getPatientData(limit = 20) {
    return new Promise(async (resolve, reject) => {
        try {
            let firstResponse = await getSinglePage(1, limit);
            let totalPages = firstResponse.pagination.totalPages;
            let allData = [...firstResponse.data];
            if (totalPages > 1) {
                let promises = [];
                for (let p = 2; p <= totalPages; p++) {
                    promises.push(getSinglePage(p, limit));
                }
                let responses = await Promise.all(promises);
                for (let res of responses) {
                    if (res && res.data) allData.push(...res.data);
                }
            }
            resolve({ data: allData });
        } catch (e) {
            console.error('Error fetching patient data:', e);
            reject(e);
        }
    });
}

async function createRiskAssessment() {
    let patientData = await getPatientData();
    patientData.data = patientData.data.map(
        item => ({
            patient_id: item.patient_id,
            age: item.age,
            blood_pressure: item.blood_pressure,
            temperature: item.temperature
        })
    );
    // console.log('patientData:', patientData.data);

    let assessment = {
        high_risk_patients: [],
        fever_patients: [],
        data_quality_issues: []
    };

    for (let patient of patientData.data) {

        // evaluate high risk patients
        let riskScore = 0;

        // Age-based risk scoring
        if (!patient.age || typeof patient.age !== 'number') assessment.data_quality_issues.push(patient.patient_id);
        else if (patient.age > 65) riskScore += 2;
        else if (patient.age > 39 && patient.age <= 65)  riskScore += 1;

        // temperature-based risk scoring
        if (!patient.temperature || typeof patient.temperature !== 'number') assessment.data_quality_issues.push(patient.patient_id);
        else if (patient.temperature >= 99.6) {
            assessment.fever_patients.push(patient.patient_id);

            if (patient.temperature <= 100.9) riskScore += 1;
            else if (patient.temperature >= 101.0) riskScore += 2;
        }

        // blood pressure-based risk scoring
        if (!patient.blood_pressure || typeof patient.blood_pressure !== 'string') assessment.data_quality_issues.push(patient.patient_id);
        else {
            let [systolic, diastolic] = patient.blood_pressure.split('/').map(Number);
            if (!systolic || typeof systolic !== 'number' || !diastolic || typeof diastolic !== 'number') assessment.data_quality_issues.push(patient.patient_id);
            else {
                if (systolic >= 140 || diastolic >= 90) riskScore += 3;
                else if ((systolic >= 130 && systolic < 140) || (diastolic >= 80 && diastolic < 90)) riskScore += 2;
                else if ((systolic >= 120 && systolic < 130) || (diastolic >= 80 && diastolic < 90)) riskScore += 1;
            }
        }

        // high risk scoring
        if (riskScore >= 4) assessment.high_risk_patients.push(patient.patient_id);
    }

    // console.log('highRiskPatients:', assessment.highRiskPatients);
    // console.log('feverPatients:', assessment.feverPatients);
    // console.log('dataQualityIssues:', assessment.dataQualityIssues);

    postRiskAssessment(assessment);
}

function postRiskAssessment(assessmentData) {
    fetch(`https://${BASE_URL}/api/submit-assessment`, {
        method: 'POST',
        headers: {
            'x-api-key': `${API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(assessmentData)
    })
    .then(res => res.json())
    .then(data => {console.log('Assessment submitted successfully:', data);})
    .catch(err => {console.error('Error submitting assessment:', err);})
}

createRiskAssessment();

module.exports = { getSinglePage, getPatientData, createRiskAssessment, postRiskAssessment };