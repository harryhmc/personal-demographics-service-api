const Boom = require('boom')
const lodash = require('lodash')
const patients = require('./patients')

function containsSearchParameters(request, searchParameters) {

    // Create new object that doesnt contain _max-result parameters as it value can change and is handled later
    function removeMaxResultParameter(parameters) {
        return lodash.pickBy(parameters, (value, key) => key !== "_max-results")
    }

    let searchParamsWithoutMaxResult = removeMaxResultParameter(searchParameters)
    let queryParamsWithoutMaxResult = removeMaxResultParameter(request.query)

    // Verifies that search parameters match query parameters
    if (!lodash.isEqual(searchParamsWithoutMaxResult, queryParamsWithoutMaxResult)) {
        return false
    }

    return true
}

function slimPatientResponse(patient) {
    // Remove parts of the patient that will not be returned on a search response
    // to align with how the backend actually performs

    let whitelist = {
        resourceType: function(patient, key) {return patient[key]},
        id: function(patient, key) {return patient[key]},
        identifier: function(patient, key) {return patient[key]},
        meta: function(patient, key) {return patient[key]},
        name: function(patient, key) {return patient[key]},
        gender: function(patient, key) {return patient[key]},
        birthDate: function(patient, key) {return patient[key]},
        deceasedDateTime: function(patient, key) {return patient[key]},
        address: function(patient, key) {
            // Only return the "home" address
            let addresses = [];
            patient[key].forEach(addr => {
                if (addr["use"] === "home") {
                    addresses.push(addr);
                }
            });
            return addresses;
        },
        generalPractitioner: function(patient, key) {return patient[key]},
        extension: function(patient, key) {
            // The only extension to return is Death Notification
            let extension = [];
            patient[key].forEach(ext => {
                if (ext["url"] === "https://simplifier.net/guide/UKCoreDecember2019/ExtensionUKCore-DeathNotificationStatus") {
                    extension.push(ext);
                }
            });
            return extension;
        }
    };

    let slimPatient = {};
    Object.keys(whitelist).forEach(function(key) {
        if (key in patient) {
            slimPatient[key] = whitelist[key](patient, key);
        }
    });
    return slimPatient;
}

function buildPatientResponse(examplePatients = [], searchScore = 1.0) {
    let response = {
        resourceType: "Bundle",
        type: "searchset",
        timestamp: Date.now(),
        total: examplePatients.length,
        entry: []
    }

    if (examplePatients.length > 0) {
        examplePatients.forEach(patient => {
            response.entry.push({
                search: {
                    score: searchScore
                },
                resource: slimPatientResponse(patient),
            })
        });
    }
    return response
}

// Verify search contains parameters
module.exports.requestContainsParameters = function(request) {
    const searchMap = {
        "_exact-match": true,
        "_history": true,
        "_fuzzy-match": true,
        "_max-results": true,
        family: "$.name[?(@.use='usual')].family", // Usual family name
        given: true,
        gender: true,
        birthdate: true,
        "death-date": true,
        "address-postcode": true,
        organisation: true,
    };

    let hasAnySearchParam = false
    for (let p of Object.keys(searchMap)) {
        if (request.query[p]) {
            hasAnySearchParam = true
            break
        }
    }
    return hasAnySearchParam
}

// Determine which 'search' to perform based on parameters passed
module.exports.search = function(request) {

    // Perform daterange search
    const dateRangeSearchParams = {
        family: "Smith",
        gender: "female",
        birthdate: ["ge2010-10-21", "le2010-10-23"]
    }
    if (containsSearchParameters(request, dateRangeSearchParams)) {
        return buildPatientResponse([patients.examplePatientSmith])
    }
    
    // Perform a fuzzy search 
    const fuzzySearchParams = {
        family: "Smith",
        gender: "female",
        birthdate: "eq2010-10-22",
        given: "Jane",
        "_fuzzy-match": "true"
    }
    if (containsSearchParameters(request, fuzzySearchParams)) {
        return buildPatientResponse([patients.examplePatientSmyth], 0.8976)
    } 

    // Check for wildcard search
    const wildcardSearchParams = {
        family: "Sm*",
        gender: "female",
        birthdate: "eq2010-10-22"
    }
    let wildcardMatch = containsSearchParameters(request, wildcardSearchParams)
    // Perform a search with max result set using the wildcard params and the max-result parameter
    if (wildcardMatch && request.query["_max-results"]) {
        if (isNaN(request.query["_max-results"]) || request.query["_max-results"] < 1 || request.query["_max-results"] > 50) {
            // Invalid parameter (Not integer)
            throw Boom.badRequest("TBC", {
                operationOutcomeCode: "TBC", apiErrorCode: "TBC"
            })
        } else if (request.query["_max-results"] < 2) {
            // max-result smaller than number of results
            throw Boom.badRequest("TBC", {
                operationOutcomeCode: "TBC", apiErrorCode: "TOO_MANY_RESULTS"
            })
        } else {
            // Return Max Result response
            return buildPatientResponse([patients.examplePatientSmith, patients.examplePatientSmyth], 0.8343)
        } 
    // Perform a advanced search as wildcard provided and max-result parameter not set
    } else if (wildcardMatch) {
        return buildPatientResponse([patients.examplePatientSmith, patients.examplePatientSmyth], 0.8343)
    }

    // Perform a 'simple search'
    const simpleSearchParams = {
        family: "Smith",
        gender: "female",
        birthdate: "eq2010-10-22",
    }
    // If so, try it
    if (containsSearchParameters(request, simpleSearchParams)) {
        return buildPatientResponse([patients.examplePatientSmith])
    }

    return buildPatientResponse()
    
}
    