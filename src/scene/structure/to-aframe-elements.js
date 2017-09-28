import runtime from '../../core/runtime.js'
import poll from '../../utils/poll.js'
import getFromStorage from '../../storage/get.js'

var validTypes = [
  'interior',
  'group',
  'level',
  'plan',
  'object',
  'camera-bookmark'
]

export default function toAframeElements(sceneStructure, options) {
  if (!sceneStructure) {
    console.error('nothing to convert')
    return
  }
  // check if the request was made by a browser
  runtime.assertBrowser()

  // api
  options = options || {}
  var isArray = Array.isArray(sceneStructure)
  console.log('isArray', isArray)
  sceneStructure = isArray ? sceneStructure : [sceneStructure]

  // start parsing
  var html = getAframeElementsFromSceneStructure(sceneStructure)
  var camHtml = parseCameraBookmarks(sceneStructure, isArray ? html : html[0])
  var result
  if (!camHtml) {
    result = isArray ? html : html[0]
  } else {
    result = (Array.isArray(html) ? html : [html]).concat(camHtml)
  }
  return result
}

// recursive parsing through sceneStructre
function getAframeElementsFromSceneStructure(sceneStructure, parent) {
  var collection = parent ? null : [] // use collection or parent
  sceneStructure.forEach(function(element3d) {
    if (validTypes.indexOf(element3d.type) > -1) {
      if (element3d.type === 'camera-bookmark' || element3d.name === 'lastSavePosition') {
        // camera bookmarks are parsed as children of the camera later
        return
      }

      var el = addEntity({
        attributes: getAttributes(element3d),
        parent: parent
      })

      if (element3d.type === 'level') {
        createBakedElement(el, element3d)
      }

      if (element3d.children && element3d.children.length) getAframeElementsFromSceneStructure(element3d.children, el)
      if (collection) collection.push(el)
    }
  })

  return collection
}

// get html attributes from element3d params
function getAttributes(element3d) {
  var attributes = {}

  switch (element3d.type) {
    case 'level':
      if (!element3d.bakedModelUrl) {
        console.warn('Level without bakedModelUrl: ', element3d)
        return
      }
      attributes['shadow'] = 'cast: false, receive: true'
      break
    case 'interior':
      attributes['io3d-furniture'] = 'id: ' + element3d.src.substring(1)
      // apply custom material settings for furniture items
      if (element3d.materials && Array.isArray(element3d.materials) ) {
        element3d.materials.forEach(function(mat) {
          if (mat.mesh && mat.material) attributes['io3d-furniture'] += '; material_' + mat.mesh.replace(/\s/g, '_') + ':' + mat.material
        })
      }
      attributes['shadow'] = 'cast: true, receive: false'
    break
    case 'object':
      attributes['io3d-data3d'] = 'key: ' + element3d.object
      attributes['shadow'] = 'cast: true, receive: true'
    break
  }

  attributes.position = element3d.x + ' ' + element3d.y + ' ' + element3d.z
  attributes.rotation = (element3d.rx || 0) + ' ' + element3d.ry + ' 0'
  attributes['io3d-uuid'] = element3d.id

  return attributes
}

// creates a child for a baked model in the current element
function createBakedElement(parentElem, element3d) {
  var attributes = {
    'io3d-data3d': 'key: ' + element3d.bakedModelUrl,
    shadow: 'cast: false, receive: true'
  }

  if (element3d.lightMapIntensity) {
    attributes['io3d-data3d'] += '; lightMapIntensity: ' + element3d.lightMapIntensity + '; lightMapExposure: ' + element3d.lightMapCenter
  }

  var bakedElem = addEntity({
    attributes: attributes,
    parent: parentElem
  })

  if (parentElem.bakeRegularStatusFileKey || parentElem.bakePreviewStatusFileKey) {
    updateOnBake(bakedElem, element3d)
  }

}

// creates a camera and tour-waypoints from scene structure
function parseCameraBookmarks(sceneStructure, planRoot) {
  var bookmarks = flattenSceneStructure(sceneStructure[0]).filter(function (element) { return element.type === 'camera-bookmark' })
  if (bookmarks.length === 0) return

  var lastSavePosition = bookmarks.find(function (element) { return element.name === 'lastSavePosition' })
  var camPosition = { x: 0, y: 1.6, z: 0 }
  var camRotation = { x: 0, y: 0, z: 0 }

  if (lastSavePosition) {
    if (lastSavePosition.mode === 'bird') {
      lastSavePosition.y += lastSavePosition.distance
    }
    //camPosition = { x: lastSavePosition.x, y: lastSavePosition.y, z: lastSavePosition.z }
    //camRotation = { x: lastSavePosition.rx, y: lastSavePosition.ry, z: 0 }
  }

  var camera = addEntity({
    attributes: {
      camera: '',
      tour: { autoStart: false },
      'wasd-controls': '',
      'look-controls': '',
      position: camPosition,
      rotation: camRotation
    }
  })

  bookmarks
    .filter(function (element) { return element.name !== 'lastSavePosition' })
    .forEach(function (element) {

      // Rotate look-at point on the XZ plane around parent's center
      var angleY = -element.parent.ry * Math.PI / 180

      var rotatedX = element.x * Math.cos(angleY) - element.z * Math.sin(angleY)
      var rotatedZ = element.z * Math.cos(angleY) + element.x * Math.sin(angleY)

      // Get world space coordinates for our look-at point
      var position = {}
      position.x = element.parent.x + rotatedX
      position.y = element.parent.y + element.y
      position.z = element.parent.z + rotatedZ

      // Get camera position by rotating around the look-at point at a distance of element.distance.
      // This will make very little difference for 'person'-type bookmarks, but it should be done for
      // the sake of correctness.
      var rx = element.rx * Math.PI / 180
      var ry = element.ry * Math.PI / 180

      position.x -= element.distance * Math.sin(ry) * Math.cos(rx)
      position.y -= element.distance * Math.sin(rx)
      position.z -= element.distance * Math.cos(ry) * Math.cos(rx)

      // Finally, get camera rotation. Note that it's necessary to add 180 degrees to the rotation angle
      // because of A-Frame's different convention. Also note that when animating the camera, the rotation
      // angle should be interpolated through the shortest arc in order to avoid swirling motion.
      var rotation = {}
      rotation.x = element.rx
      rotation.y = 180 + element.parent.ry + element.ry

      if (element.mode === 'bird' || element.mode === 'floorplan') position.y = Math.max(element.distance - 5, 8)
      addEntity({
        parent: camera,
        attributes: {
          'tour-waypoint': element.name,
          'io3d-uuid': element.id,
          position: position,
          rotation: rotation
        }
      })
    })

  return camera
}


function addEntity(args) {
  var
    tag = args.tag || 'a-entity',
    parent = args.parent,
    attributes = args.attributes || {}

  var el = document.createElement(tag)

  Object.keys(attributes).forEach(function(key) {
    el.setAttribute(key, attributes[key])
  })

  if (parent) return parent.appendChild(el)
  else return el
}

function updateOnBake(htmlElement, element3d) {
  var statusFileKey = element3d.bakeRegularStatusFileKey || element3d.bakePreviewStatusFileKey

  pollStatusFile(statusFileKey)
    .then(function (bakedModelKey) {
      var attribValue = 'key: ' + bakedModelKey
      if (element3d.lightMapIntensity) {
        attribValue += '; lightMapIntensity: ' + element3d.lightMapIntensity + '; lightMapExposure: ' + element3d.lightMapCenter
      }

      htmlElement.setAttribute('io3d-data3d', attribValue)
    })
}

// TODO: Migrate that to a shared helper

function pollStatusFile(fileKey) {
  return poll(function onPoll(onSuccess, onError, next) {
    /*
    1. Read status file content
    2. Check if we're done -> call onSuccess
       Check if it failed  -> call onError
       Otherwise call next
     */
    getFromStorage(fileKey, { type: "json", cdn: false }).then(function checkContent(content) {
      if (content && content.params) {
        switch (content.params.status) {
          case 'SUCCESS':
            onSuccess(content.params.data)
            break
          case 'PROCESSING':
          case 'ENQUEUED':
            next()
            break
          default:
            onError(content.params.data)
        }
      }
    })
  })
}

function flattenSceneStructure(sceneStructure, parent) {
  var result = []
  sceneStructure.parent = parent
  result.push(sceneStructure)
  if(sceneStructure.children) {
    sceneStructure.children.forEach(function (child) {
      result = result.concat(flattenSceneStructure(child, sceneStructure))
    })
  }
  return result
}

function deg2rad(x) { return x * (Math.PI / 180) }
function rad2deg(x) { return x * (180 / Math.PI) }