const fs = require('fs');
const path = require('path');

class EnvironmentValidator {
  constructor() {
    this.requiredVars = [
      {
        name: 'GOOGLE_CLIENT_ID',
        description: 'Google OAuth client ID',
        category: 'Authentication',
        critical: true
      },
      {
        name: 'GOOGLE_CLIENT_SECRET',
        description: 'Google OAuth client secret',
        category: 'Authentication',
        critical: true
      }
    ];

    this.recommendedVars = [
      {
        name: 'SESSION_SECRET',
        description: 'Session encryption secret',
        category: 'Security',
        critical: true,
        defaultValue: 'fallback-secret-change-in-production',
        warning: 'Using default session secret is insecure for production!'
      },
      {
        name: 'ADMIN_EMAIL',
        description: 'Administrator email for approval notifications',
        category: 'Email',
        critical: false,
        defaultValue: 'niklasbrock@gmail.com'
      },
      {
        name: 'CORS_ORIGIN',
        description: 'Allowed CORS origin',
        category: 'Security',
        critical: false,
        defaultValue: 'https://leoshare.dk'
      },
      {
        name: 'BASE_URL',
        description: 'Base URL for download links',
        category: 'Server',
        critical: false,
        defaultValue: 'http://localhost:3001'
      },
      {
        name: 'FRONTEND_URL',
        description: 'Frontend URL for redirects',
        category: 'Server',
        critical: false,
        defaultValue: 'https://leoshare.dk'
      }
    ];

    this.emailVars = [
      {
        name: 'SMTP_HOST',
        description: 'SMTP server hostname',
        category: 'Email',
        critical: false
      },
      {
        name: 'SMTP_USER',
        description: 'SMTP username',
        category: 'Email',
        critical: false
      },
      {
        name: 'SMTP_PASS',
        description: 'SMTP password',
        category: 'Email',
        critical: false
      },
      {
        name: 'SMTP_PORT',
        description: 'SMTP server port',
        category: 'Email',
        critical: false,
        defaultValue: '587'
      },
      {
        name: 'SMTP_FROM',
        description: 'From email address',
        category: 'Email',
        critical: false
      }
    ];

    this.optionalVars = [
      {
        name: 'PORT',
        description: 'Server port',
        category: 'Server',
        critical: false,
        defaultValue: '3001'
      },
      {
        name: 'UPLOAD_PATH',
        description: 'File upload directory',
        category: 'Storage',
        critical: false,
        defaultValue: './uploads'
      },
      {
        name: 'MAX_FILE_SIZE',
        description: 'Maximum file size in bytes',
        category: 'Storage',
        critical: false,
        defaultValue: '1073741824'
      },
      {
        name: 'GOOGLE_REDIRECT_URI',
        description: 'Google OAuth redirect URI',
        category: 'Authentication',
        critical: false,
        defaultValue: 'https://leoshare.dk/auth/google/callback'
      }
    ];

    this.allVars = [...this.requiredVars, ...this.recommendedVars, ...this.emailVars, ...this.optionalVars];
  }

  // Validate all environment variables
  validate() {
    console.log('🔍 Validating environment configuration...\n');

    const results = {
      valid: true,
      critical: true,
      errors: [],
      warnings: [],
      missing: [],
      categories: {}
    };

    // Group variables by category
    const categories = {};
    this.allVars.forEach(variable => {
      if (!categories[variable.category]) {
        categories[variable.category] = [];
      }
      categories[variable.category].push(variable);
    });

    // Validate each category
    Object.keys(categories).forEach(category => {
      console.log(`📋 ${category} Variables:`);
      results.categories[category] = {
        valid: true,
        variables: []
      };

      categories[category].forEach(variable => {
        const result = this.validateVariable(variable);
        results.categories[category].variables.push(result);

        if (!result.valid && variable.critical) {
          results.critical = false;
          results.valid = false;
          results.errors.push(`${variable.name}: ${result.message}`);
        } else if (!result.valid) {
          results.warnings.push(`${variable.name}: ${result.message}`);
        }

        if (result.missing) {
          results.missing.push(variable.name);
        }

        // Print result
        const status = result.valid ? '✅' : (variable.critical ? '❌' : '⚠️');
        const value = result.masked ? '***SET***' : (result.value || 'NOT SET');
        console.log(`   ${status} ${variable.name}: ${value}`);
        
        if (result.message && !result.valid) {
          console.log(`      ${result.message}`);
        }
      });
      console.log('');
    });

    // Check email configuration completeness
    const emailComplete = this.validateEmailConfiguration();
    if (!emailComplete.valid) {
      results.warnings.push('Email configuration incomplete - some features will be limited');
    }

    // Print summary
    this.printSummary(results, emailComplete);

    return results;
  }

  // Validate individual variable
  validateVariable(variable) {
    const value = process.env[variable.name];
    const result = {
      name: variable.name,
      value: value,
      valid: false,
      missing: false,
      masked: false,
      message: ''
    };

    // Mask sensitive values
    if (variable.name.includes('SECRET') || variable.name.includes('PASS') || variable.name.includes('KEY')) {
      result.masked = true;
    }

    if (!value) {
      result.missing = true;
      if (variable.critical) {
        result.message = `Required variable missing: ${variable.description}`;
      } else if (variable.defaultValue) {
        result.valid = true;
        result.value = variable.defaultValue;
        result.message = `Using default value: ${variable.defaultValue}`;
        
        if (variable.warning) {
          result.message = variable.warning;
          result.valid = true; // Still valid but with warning
        }
      } else {
        result.message = `Optional variable not set: ${variable.description}`;
      }
    } else {
      result.valid = true;
      
      // Special validation for specific variables
      if (variable.name === 'SESSION_SECRET' && value === 'fallback-secret-change-in-production') {
        result.message = variable.warning || 'Using fallback session secret - change for production!';
      }

      if (variable.name === 'MAX_FILE_SIZE' && isNaN(parseInt(value))) {
        result.valid = false;
        result.message = 'MAX_FILE_SIZE must be a number';
      }

      if (variable.name === 'PORT' && (isNaN(parseInt(value)) || parseInt(value) < 1 || parseInt(value) > 65535)) {
        result.valid = false;
        result.message = 'PORT must be a valid port number (1-65535)';
      }
    }

    return result;
  }

  // Validate email configuration as a group
  validateEmailConfiguration() {
    const requiredEmailVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
    const missing = requiredEmailVars.filter(varName => !process.env[varName]);
    
    return {
      valid: missing.length === 0,
      complete: missing.length === 0,
      missing: missing,
      message: missing.length > 0 ? `Missing email variables: ${missing.join(', ')}` : 'Email configuration complete'
    };
  }

  // Print validation summary
  printSummary(results, emailConfig) {
    console.log('📊 Environment Validation Summary:');
    console.log('=' .repeat(50));
    
    if (results.critical) {
      console.log('✅ All critical variables are configured');
    } else {
      console.log('❌ Critical configuration issues found!');
      results.errors.forEach(error => {
        console.log(`   ❌ ${error}`);
      });
    }

    if (results.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      results.warnings.forEach(warning => {
        console.log(`   ⚠️  ${warning}`);
      });
    }

    console.log(`\n📧 Email System: ${emailConfig.complete ? '✅ Fully Configured' : '⚠️ Limited (missing variables)'}`);

    if (results.missing.length > 0) {
      console.log(`\n📝 Missing Variables (${results.missing.length}):`);
      results.missing.forEach(varName => {
        const variable = this.allVars.find(v => v.name === varName);
        const status = variable && variable.critical ? 'CRITICAL' : 'Optional';
        console.log(`   • ${varName} (${status}): ${variable ? variable.description : 'Unknown'}`);
      });
    }

    console.log('\n' + '=' .repeat(50));
    
    if (!results.critical) {
      console.log('🚨 SERVER CANNOT START - Fix critical issues above!');
      return false;
    } else if (results.warnings.length > 0) {
      console.log('⚠️  Server will start with warnings - review configuration for optimal operation');
    } else {
      console.log('🎉 Environment configuration is optimal!');
    }

    return results.critical;
  }

  // Generate example .env file
  generateExampleEnv() {
    const envPath = path.join(__dirname, '.env.example');
    let content = '# LeoShare File Sharing - Environment Variables\n';
    content += '# Copy this file to .env and fill in your values\n\n';

    const categories = {};
    this.allVars.forEach(variable => {
      if (!categories[variable.category]) {
        categories[variable.category] = [];
      }
      categories[variable.category].push(variable);
    });

    Object.keys(categories).forEach(category => {
      content += `# ${category} Configuration\n`;
      categories[category].forEach(variable => {
        const example = variable.defaultValue || (variable.critical ? 'your-value-here' : '');
        const required = variable.critical ? ' (REQUIRED)' : ' (Optional)';
        content += `# ${variable.description}${required}\n`;
        content += `${variable.name}=${example}\n\n`;
      });
    });

    try {
      fs.writeFileSync(envPath, content);
      console.log(`📝 Generated example environment file: ${envPath}`);
    } catch (error) {
      console.error('❌ Could not generate .env.example:', error.message);
    }
  }
}

module.exports = EnvironmentValidator;