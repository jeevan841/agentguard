const PDFDocument = require('pdfkit');

/**
 * Generates a PDF buffer for a Red-Team run.
 * @param {Object} run - The RedTeamRun object from the database.
 * @returns {Promise<Buffer>} - The generated PDF as a buffer.
 */
function generateRedTeamPdf(run) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
      doc.on('error', reject);

      // Title
      doc.fontSize(24).font('Helvetica-Bold').text('AgentGuard', { align: 'center' });
      doc.fontSize(16).font('Helvetica').text('Red-Team Assessment Report', { align: 'center' });
      doc.moveDown(2);

      // Summary Details
      doc.fontSize(12).font('Helvetica-Bold').text('Run Details');
      doc.font('Helvetica').text(`Run ID: ${run.id}`);
      doc.text(`Agent: ${run.agent?.name || 'Unknown'}`);
      doc.text(`Status: ${run.status}`);
      doc.text(`Completed At: ${run.completed_at ? new Date(run.completed_at).toLocaleString() : 'N/A'}`);
      doc.moveDown(1);

      // Score
      doc.font('Helvetica-Bold').text('Overall Score');
      doc.font('Helvetica').text(`Pass Rate: ${run.pass_rate != null ? run.pass_rate.toFixed(1) + '%' : 'N/A'}`);
      doc.text(`Passed Tests: ${run.passed_tests || 0}`);
      doc.text(`Failed Tests: ${run.failed_tests || 0}`);
      doc.text(`Total Tests: ${run.total_tests || 0}`);
      doc.moveDown(1);

      // Summary Text
      if (run.summary) {
        doc.font('Helvetica-Bold').text('Executive Summary');
        doc.font('Helvetica').text(run.summary, { align: 'justify' });
        doc.moveDown(1);
      }

      // Recommendations
      if (run.recommendations && run.recommendations.length > 0) {
        doc.font('Helvetica-Bold').text('Recommendations');
        run.recommendations.forEach((rec, idx) => {
          doc.font('Helvetica').text(`${idx + 1}. ${rec}`);
        });
        doc.moveDown(1);
      }

      // Detailed Results
      if (run.results && run.results.length > 0) {
        doc.addPage();
        doc.fontSize(16).font('Helvetica-Bold').text('Detailed Test Results');
        doc.moveDown(1);

        run.results.forEach((result, idx) => {
          doc.fontSize(12).font('Helvetica-Bold').text(`Test ${idx + 1}: ${result.attack_name || result.attack_type}`);
          doc.font('Helvetica').fontSize(10);
          doc.text(`Category: ${result.attack_type}`);
          doc.text(`Status: ${result.was_fooled ? 'FAILED' : 'PASSED'}`, { color: result.was_fooled ? 'red' : 'green' });
          doc.fillColor('black'); // Reset color
          doc.text(`Fooled Score: ${result.fooled_score}/5`);
          doc.text(`Severity: ${result.severity}`);
          if (result.reason) {
            doc.text(`Reason: ${result.reason}`);
          }
          if (result.recommended_guardrail) {
            doc.text(`Recommendation: ${result.recommended_guardrail}`);
          }
          doc.moveDown(1);
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateRedTeamPdf };
