[![mPlane](http://www.ict-mplane.eu/sites/default/files//public/mplane_final_256x_0.png)](http://www.ict-mplane.eu/)

#mPlane DATI proxy


This is the [mPlane](http://www.ict-mplane.eu/) nodejs proxy library for the DATI probe.
DATI is a closed software, developed outside the context of the project and is not publicly available. This software enables DATI to interact with network elements that are mPlane capable. 


#Installation

`npm install`

#Example
In order to define a simple mplane measure `capability` for a pinger, we should import the library, define `parameters` (with `constraints`), `results` and instantiate a `Capability` object.


```javascript
var mplane = require('mplane');

// The IP address of the pinger
var __MY_IP__ = "192.168.0.123";

// Initialize available primitives from the registry
mplane.Element.initialize_registry("registry.json");

// Source address and destination parameters initialized from the registry
var sourceAddress = new mplane.Element("source.ip");
//  It will ping only from its own IP
sourceAddress.addConstraint( __MY_IP__ ); 

// Destination
var destinationAddress = new mplane.Element("destination");
destinationAddress.addConstraint( "192.168.0.1 ... 192.168.0.122"); 

// We can define a parameter with a Json object
var numberOfEchoRequests = new mplane.Element({ name:"Number of echo requests" , 
                                                prim: mplane.Primitive.NATURAL, 
                                                desc:"Defines the number of echo requests the pinger should issue"
                                            });
numberOfEchoRequests.addConstraint("1 ... 10");

// Ping result - MEAN RTT
var meanRTT = new mplane.Element("delay.twoway");

// Ready to prepare the Capability
var statement = new mplane.Statement({verb:mplane.Statement.VERB_COLLECT});

// We add all the parameters
statement.add_parameter("My source address" , sourceAddress , __MY_IP__);

// Here we should set a valid ip address in accordance with the constraints on the destinationAddress
statement.add_parameter("The destination address" , destinationAddress , "192.168.0.1");
statement.add_parameter("The number of echo requests the pinger should send" , numberOfEchoRequests , 1);

// The pinger will return a single column result
statement.add_result_column("Mean RTT", meanRTT);

// THE CAPABILITY we will announce
var capability = new mplane.Capability(statement);

```
Please refer to the Examples directory for a working mPlane supervisor and pinger.

#Documentation

Please refer to the API reference [mPlane nodejs API](http://finvernizzi.github.io/mplane/)

##LICENSE

This software is released under the [BSD](http://en.wikipedia.org/wiki/BSD_licenses#2-clause_license_.28.22Simplified_BSD_License.22_or_.22FreeBSD_License.22.29) license.
